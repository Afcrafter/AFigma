/**
 * 把 AI 分析结果格式化为企业微信 Markdown 卡片（手机端一屏速览）。
 *
 * 设计要点：
 *  - 精简输出：不直接输出几十行 JSX/HTML，只给「结构 + 配色 + 建议 + 核心类名」
 *  - 干净 Markdown：不转义 HTML 实体，代码以反引号内联类名形式展示
 *  - 总长度控制在 300 字内，避免企微折叠与截断
 *
 * 企微 markdown 语法：
 *  - 支持 `##` 标题 / `>` 引用 / `**加粗**` / `[链接](url)`
 *  - 支持高亮标签：<font color="info">绿</font> / <font color="comment">灰</font>
 *    / <font color="warning">黄</font>
 */
import type {
  AnalysisResult,
  FigmaDesignTokens,
  FigmaExport,
  FigmaNodeInfo,
} from "../types/wechat";

const TITLE = "## 🎨 UI 视觉与设计规范速览";

/* ---- 企微高亮标签 ---- */
const info = (t: string): string => `<font color="info">${t}</font>`;
const comment = (t: string): string => `<font color="comment">${t}</font>`;
const warning = (t: string): string => `<font color="warning">${t}</font>`;

/** 正文长度上限（字符）：链接标题另算，企微显示总长保证 <300 一屏展示。 */
const MAX_BODY_CHARS = 270;

export interface AnalysisMarkdownOpts {
  nodeInfo?: FigmaNodeInfo;
  exports?: FigmaExport[];
  tokens?: FigmaDesignTokens;
  /** Figma 原稿直达链接 */
  figmaUrl?: string;
  /** 分析耗时（毫秒） */
  durationMs?: number;
}

/** 从 tailwindSnippet 中提取核心原子类名（去重，最多 5 个）。 */
function extractKeyClasses(tailwind: string): string[] {
  if (!tailwind) return [];
  const classes = new Set<string>();
  const re = /className={?["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tailwind))) {
    for (const c of m[1].split(/\s+/)) {
      if (c && c.length < 30 && !c.includes("${")) classes.add(c);
    }
  }
  return [...classes].slice(0, 5);
}

/** 配色行：优先 Design Token 名称，否则用 LLM 提取的色值（带语义标签）。 */
function colorLines(
  analysis: AnalysisResult,
  tokens?: FigmaDesignTokens
): string[] {
  if (tokens?.colors?.length) {
    return tokens.colors
      .slice(0, 3)
      .map((c, i) => `• ${c.name || `色 ${i + 1}`}：\`${c.value}\``);
  }
  const labels = ["主色", "强调色", "中性色"];
  return (analysis.primaryColors || [])
    .slice(0, 3)
    .map((v, i) => `• ${labels[i] || `色 ${i + 1}`}：\`${v}\``);
}

/** 分析开始前的"处理中"提示。 */
export function formatProcessingMarkdown(nodeName?: string): string {
  return [
    TITLE,
    "",
    nodeName ? `> 正在解析：**${nodeName}**` : "> 正在分析你的图片/链接",
    "",
    comment("预计 30~60 秒，结果会自动推送。"),
  ].join("\n");
}

/** 无 Figma 链接时的提示。 */
export function formatNoLinkMarkdown(): string {
  return [
    TITLE,
    "",
    warning("**未检测到 Figma 链接**"),
    "",
    "请发送一个 Figma 画板链接，或直接粘贴画板截图：",
    "> 截图可用 Ctrl+V 直接粘贴发送",
    "",
    comment("截图分析完全绕过 Figma API，不受限流影响。"),
  ].join("\n");
}

/** 错误提示：识别 Figma 429 频控，给出专门友好的提示。 */
export function formatErrorMarkdown(message: string): string {
  if (/频控|429|Rate.?Limit/i.test(message)) {
    return [
      TITLE,
      "",
      warning("**⚠️ Figma 官方频控中**"),
      "",
      "请求过于频繁，请等待 **1 分钟**后再试，或直接发送画板截图。",
      "",
      comment("截图（Ctrl+V）可秒级分析，绕过 Figma API 限流。"),
    ].join("\n");
  }
  return [
    TITLE,
    "",
    warning("**⚠️ 分析失败**"),
    "",
    message,
    "",
    comment("可尝试直接发送画板截图分析。"),
  ].join("\n");
}

/** 把设计分析结果格式化为企微 markdown 速览卡片（≤300 字）。 */
export function formatAnalysisMarkdown(
  analysis: AnalysisResult,
  opts: AnalysisMarkdownOpts = {}
): string {
  const { exports, tokens, figmaUrl, durationMs } = opts;
  const lines: string[] = [];

  lines.push(TITLE);
  lines.push("");
  lines.push(`> 综合可用性评分：${info(`**${analysis.usabilityScore} / 10**`)}`);
  lines.push("");

  // 📐 结构与组件
  lines.push("**📐 结构与组件**");
  if (analysis.interfaceLevels) {
    lines.push(`• 布局层级：${analysis.interfaceLevels.slice(0, 30)}`);
  }
  const keyClasses = extractKeyClasses(analysis.tailwindSnippet);
  if (keyClasses.length) {
    lines.push(`• 关键样式：\`${keyClasses.slice(0, 4).join("` `")}\``);
  }
  lines.push("");

  // 🎨 提取配色
  lines.push("**🎨 提取配色 (Tokens)**");
  const colors = colorLines(analysis, tokens);
  for (const c of colors.slice(0, 3)) lines.push(c);
  lines.push("");

  // 💡 体验优化建议（最多 2 条，保证 300 字内一屏展示）
  if (analysis.suggestions?.length) {
    lines.push("**💡 体验优化建议**");
    analysis.suggestions
      .slice(0, 2)
      .forEach((s, i) => lines.push(`${i + 1}. ${s.slice(0, 18)}`));
    lines.push("");
  }

  // 链接：高清图 / Figma 原稿（企微显示标题，URL 不占显示预算）
  const links: string[] = [];
  const firstExport = exports?.[0];
  if (firstExport?.imageUrl) links.push(`[🔗 高清图](${firstExport.imageUrl})`);
  if (figmaUrl) links.push(`[📐 原稿](${figmaUrl})`);

  // 正文（不含链接）控制在 ~270 字；链接标题短，企微显示总长 <300
  const body = lines.join("\n");
  const bodyTrimmed =
    body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + "…" : body;
  return links.length ? `${bodyTrimmed}\n---\n${links.join(" · ")}` : bodyTrimmed;
}
