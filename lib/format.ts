/**
 * 把 AI 分析结果 + Figma 切图链接格式化为企业微信 Markdown 卡片。
 *
 * 企微 markdown 语法要点：
 *  - 支持 `##` 标题 / `>` 引用 / `**加粗**` / `[链接](url)`
 *  - 支持高亮标签：<font color="info">绿</font> / <font color="comment">灰</font>
 *    / <font color="warning">黄</font> / <font color="highlight">红</font>
 *  - **不渲染 ``` 代码围栏** → 代码按普通文本段落精简展示，并转义 HTML
 *    特殊字符（防 JSX 的 <div> 被渲染引擎当标签吞掉）。
 */
import type {
  AnalysisResult,
  FigmaDesignTokens,
  FigmaExport,
  FigmaNodeInfo,
} from "../types/wechat";

const TITLE = "## 🎨 Figma UI 视觉与组件分析";
const MAX_SNIPPET_LEN = 700;

/* ---- 企微高亮标签 ---- */
const info = (t: string): string => `<font color="info">${t}</font>`;
const comment = (t: string): string => `<font color="comment">${t}</font>`;
const warning = (t: string): string => `<font color="warning">${t}</font>`;

function truncate(s: string, max = MAX_SNIPPET_LEN): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 转义代码中的 HTML 特殊字符，避免 JSX 标签被企微渲染引擎吞掉。 */
function escapeCode(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface AnalysisMarkdownOpts {
  nodeInfo?: FigmaNodeInfo;
  exports?: FigmaExport[];
  tokens?: FigmaDesignTokens;
  /** Figma 原稿直达链接 */
  figmaUrl?: string;
  /** 分析耗时（毫秒） */
  durationMs?: number;
}

/** 分析开始前的"处理中"提示。 */
export function formatProcessingMarkdown(nodeName?: string): string {
  return [
    TITLE,
    "",
    nodeName ? `> 正在解析画板：**${nodeName}**` : "> 正在解析你的 Figma 链接",
    "",
    "已收到设计稿，正在导出高清图并调用视觉模型分析，",
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
    "请发送一个 Figma 画板链接，例如：",
    "> https://www.figma.com/design/abc123/页面?node-id=0%3A1",
    "",
    comment("可带 node-id 指定画板，否则自动取首个 Frame。"),
  ].join("\n");
}

/** 错误提示。 */
export function formatErrorMarkdown(message: string): string {
  return [
    TITLE,
    "",
    warning("**⚠️ 分析失败**"),
    "",
    message,
    "",
    comment("请确认 FIGMA_ACCESS_TOKEN 有效、模型支持图片输入、链接可访问。"),
  ].join("\n");
}

/** 把设计分析结果格式化为企微 markdown 卡片。 */
export function formatAnalysisMarkdown(
  analysis: AnalysisResult,
  opts: AnalysisMarkdownOpts = {}
): string {
  const { nodeInfo, exports, tokens, figmaUrl, durationMs } = opts;
  const lines: string[] = [];

  lines.push(TITLE);
  lines.push("");

  // 基本信息引用块
  const meta: string[] = [];
  if (nodeInfo?.name) meta.push(`画板名称：**${nodeInfo.name}**`);
  if (nodeInfo?.width) meta.push(`尺寸：**${nodeInfo.width}x${nodeInfo.height ?? "?"}**`);
  lines.push(`> ${meta.join(" | ")} | ${info("已完成解析")}`);
  lines.push("");

  // 1️⃣ 界面层级
  lines.push("**1️⃣ 界面层级**");
  lines.push(analysis.interfaceLevels || comment("（模型未给出）"));
  lines.push("");

  // 2️⃣ 主色调（优先 Design Token 名称，否则用 LLM 提取的色值）
  lines.push("**2️⃣ 主色调**");
  let colors: { label: string; value: string; name?: string }[] = [];
  if (tokens?.colors?.length) {
    colors = tokens.colors.slice(0, 4).map((c, i) => ({
      label: i === 0 ? "主色" : `辅色 ${i}`,
      value: c.value,
      name: c.name,
    }));
  } else {
    colors = (analysis.primaryColors || []).slice(0, 4).map((v, i) => ({
      label: i === 0 ? "主色" : `辅色 ${i}`,
      value: v,
    }));
  }
  if (colors.length) {
    for (const c of colors) {
      lines.push(`• ${c.label}：\`${c.value}\`${c.name ? ` (${c.name})` : ""}`);
    }
  } else {
    lines.push(comment("未检测到主色"));
  }
  lines.push("");

  // 3️⃣ 可用性评分（高亮：≥7 绿，<7 黄）
  lines.push("**3️⃣ 可用性评分**");
  const score = analysis.usabilityScore;
  lines.push(score >= 7 ? info(`**${score} / 10**`) : warning(`**${score} / 10**`));
  lines.push("");

  // 4️⃣ 改进建议
  if (analysis.suggestions?.length) {
    lines.push("**4️⃣ 改进建议**");
    analysis.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  // 5️⃣ / 6️⃣ 代码（精简 + 转义 HTML，优先关键结构与 Tailwind 类名）
  if (analysis.tailwindSnippet) {
    lines.push("**5️⃣ Tailwind 代码（关键结构）**");
    lines.push(truncate(escapeCode(analysis.tailwindSnippet)));
    lines.push("");
  }
  if (analysis.reactSnippet) {
    lines.push("**6️⃣ React 组件（精简）**");
    lines.push(truncate(escapeCode(analysis.reactSnippet)));
    lines.push("");
  }

  // 7️⃣ 高清切图 & Figma 原稿
  lines.push("**🖼️ 高清切图 & 原稿**");
  const exportList = exports ?? [];
  for (const e of exportList.slice(0, 1)) {
    lines.push(`[🔗 查看高清图 (${e.format})](${e.imageUrl})`);
  }
  if (figmaUrl) lines.push(`[📐 Figma 原稿直达](${figmaUrl})`);
  lines.push("");

  // 页脚：耗时 + 来源
  const footer: string[] = [];
  if (durationMs != null) {
    footer.push(comment(`耗时 ${(durationMs / 1000).toFixed(1)}s`));
  }
  footer.push(comment("由企业微信 + Figma + LLM 自动生成"));
  lines.push(footer.join(" · "));

  return lines.join("\n");
}
