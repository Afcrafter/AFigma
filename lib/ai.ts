/**
 * 多模态 UI 设计分析：把 Figma 高清切图 URL 投喂给 OpenAI 兼容的视觉大模型。
 * 读取 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（用户自建端点，模型需支持图片输入）。
 */
import OpenAI from "openai";
import { env } from "./env";
import type { AnalysisResult, FigmaDesignTokens, FigmaNodeInfo } from "../types/wechat";

const SYSTEM_PROMPT = `你是一位资深 UI 设计师与前端工程师。请分析用户提供的界面设计图，输出严格的 JSON 对象（不要输出任何其他文字或 markdown 围栏），结构如下：
{
  "interfaceLevels": "对界面信息层级结构的简述（如：顶部导航 → 主视觉 → 内容卡片 → 底部操作区）",
  "primaryColors": ["主色调1", "主色调2", "强调色"],
  "usabilityScore": 8,
  "suggestions": ["可用性改进建议1", "建议2", "建议3"],
  "tailwindSnippet": "用 Tailwind CSS 实现该界面基础布局的 JSX 代码片段（尽量精简）",
  "reactSnippet": "用 React 组件（function component）实现核心布局的 TypeScript 代码片段"
}
注意：usabilityScore 是 0-10 的整数；suggestions 至少 2 条、最多 4 条；代码片段保持简洁可读。`;

const TIMEOUT_MS = 45_000;

/** 从模型输出中稳健地解析出 JSON 对象（容忍 markdown 围栏与前后杂质）。 */
export function parseAnalysisJson(text: string): AnalysisResult {
  if (!text) throw new Error("模型返回为空");
  let cleaned = text.trim();
  // 剥离 ```json ... ``` 围栏
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  // 截取首个 { 到最后一个 }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  try {
    const obj = JSON.parse(cleaned) as Partial<AnalysisResult>;
    return {
      interfaceLevels: String(obj.interfaceLevels ?? ""),
      primaryColors: Array.isArray(obj.primaryColors)
        ? obj.primaryColors.map(String)
        : [],
      usabilityScore: Number.isFinite(Number(obj.usabilityScore))
        ? Math.max(0, Math.min(10, Number(obj.usabilityScore)))
        : 0,
      suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.map(String) : [],
      tailwindSnippet: String(obj.tailwindSnippet ?? ""),
      reactSnippet: String(obj.reactSnippet ?? ""),
    };
  } catch (e) {
    throw new Error(`模型输出无法解析为 JSON: ${(e as Error).message}`);
  }
}

/**
 * 分析设计图。nodeInfo/tokens 作为上下文注入 prompt 增强准确性。
 */
export async function analyzeDesign(
  imageUrl: string,
  nodeInfo?: FigmaNodeInfo,
  tokens?: FigmaDesignTokens
): Promise<AnalysisResult> {
  if (!env.llm.apiKey || !env.llm.baseURL || !env.llm.model) {
    throw new Error("LLM 环境变量未配置完整（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）");
  }
  const client = new OpenAI({
    apiKey: env.llm.apiKey,
    baseURL: env.llm.baseURL,
    timeout: TIMEOUT_MS,
  });

  let context = "";
  if (nodeInfo) {
    context += `画板信息：名称="${nodeInfo.name}"，类型=${nodeInfo.type ?? "未知"}，尺寸=${nodeInfo.width ?? "?"}x${nodeInfo.height ?? "?"}，子节点=${nodeInfo.childCount} 个。`;
    if (nodeInfo.fillColors.length) {
      context += `检测到主色：${nodeInfo.fillColors.slice(0, 6).join(", ")}。`;
    }
    if (nodeInfo.fonts.length) {
      context += `检测到字体：${nodeInfo.fonts.slice(0, 4).join(", ")}。`;
    }
  }
  if (tokens?.colors?.length) {
    context += `Design Token 颜色：${tokens.colors.slice(0, 6).map((c) => `${c.name}=${c.value}`).join(", ")}。`;
  }

  const userText = context
    ? `这是画板「${nodeInfo?.name ?? ""}」的设计图。\n${context}\n请按系统要求分析：`
    : "请按系统要求分析这张设计图：";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];

  let res: OpenAI.Chat.Completions.ChatCompletion;
  try {
    res = await client.chat.completions.create(
      {
        model: env.llm.model,
        temperature: 0.2,
        max_tokens: 2048,
        messages,
        response_format: { type: "json_object" },
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
  } catch (err) {
    const msg = (err as Error).message || String(err);
    // 部分 OpenAI 兼容端点不支持 response_format → 降级重试一次
    if (/response_format|json_object|unsupported|not support/i.test(msg)) {
      res = await client.chat.completions.create(
        {
          model: env.llm.model,
          temperature: 0.2,
          max_tokens: 2048,
          messages,
        },
        { signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
    } else {
      throw new Error(`LLM 分析失败: ${msg}`);
    }
  }

  const content = res.choices?.[0]?.message?.content ?? "";
  return parseAnalysisJson(content);
}
