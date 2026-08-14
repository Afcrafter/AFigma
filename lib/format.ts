/**
 * 把 AI 分析结果 + Figma 切图链接格式化为企业微信 Markdown 消息。
 * 注意：企微 markdown 不渲染代码围栏（```），代码块按普通文本段落放入。
 */
import type {
  AnalysisResult,
  FigmaDesignTokens,
  FigmaExport,
  FigmaNodeInfo,
} from "../types/wechat";

const MAX_SNIPPET_LEN = 800;

function truncate(s: string, max = MAX_SNIPPET_LEN): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 分析开始前的"处理中"提示。 */
export function formatProcessingMarkdown(nodeName?: string): string {
  return [
    `**Figma 设计分析中 🔍**`,
    ``,
    `已收到设计稿${nodeName ? `「${nodeName}」` : ""}，正在导出高清图并调用视觉模型分析，`,
    `预计 30~60 秒，请稍候，结果会自动推送给你。`,
  ].join("\n");
}

/** 无 Figma 链接时的提示。 */
export function formatNoLinkMarkdown(): string {
  return [
    `**请发送 Figma 链接**`,
    ``,
    `请把要分析的 Figma 画板链接发给我，例如：`,
    `> https://www.figma.com/design/abc123/页面?node-id=0%3A1`,
    ``,
    `（可带 node-id 指定画板，否则分析整页首个 Frame）`,
  ].join("\n");
}

/** 错误提示。 */
export function formatErrorMarkdown(message: string): string {
  return [
    `**⚠️ 分析失败**`,
    ``,
    message,
    ``,
    `> 提示：请确认 FIGMA_ACCESS_TOKEN 有效、模型支持图片输入、Figma 链接权限可访问。`,
  ].join("\n");
}

/** 把设计分析结果格式化为企微 markdown 卡片。 */
export function formatAnalysisMarkdown(
  analysis: AnalysisResult,
  nodeInfo?: FigmaNodeInfo,
  exports?: FigmaExport[],
  tokens?: FigmaDesignTokens
): string {
  const lines: string[] = [];
  lines.push(`**📐 设计分析报告**`);
  if (nodeInfo?.name) lines.push(`画板：**${nodeInfo.name}**`);
  lines.push(``);

  // 界面层级
  lines.push(`**1️⃣ 界面层级**`);
  lines.push(analysis.interfaceLevels || "（模型未给出）");
  lines.push(``);

  // 主色
  const colors = analysis.primaryColors.length
    ? analysis.primaryColors
    : tokens?.colors.map((c) => c.value).slice(0, 4);
  lines.push(`**2️⃣ 主色调**`);
  lines.push(colors?.length ? colors.join(" · ") : "（未检测到）");
  lines.push(``);

  // 可用性评分
  lines.push(`**3️⃣ 可用性评分**`);
  lines.push(`**${analysis.usabilityScore} / 10**`);
  lines.push(``);

  // 建议
  if (analysis.suggestions?.length) {
    lines.push(`**4️⃣ 改进建议**`);
    analysis.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push(``);
  }

  // 代码片段
  if (analysis.tailwindSnippet) {
    lines.push(`**5️⃣ Tailwind 代码**`);
    lines.push(truncate(analysis.tailwindSnippet));
    lines.push(``);
  }
  if (analysis.reactSnippet) {
    lines.push(`**6️⃣ React 代码**`);
    lines.push(truncate(analysis.reactSnippet));
    lines.push(``);
  }

  // Figma 高清切图下载链接
  if (exports?.length) {
    lines.push(`**🖼️ 高清切图下载**`);
    for (const e of exports.slice(0, 3)) {
      lines.push(`[节点 ${e.nodeId} (${e.format})](${e.imageUrl})`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*由企业微信 + Figma + LLM 自动生成*`);
  return lines.join("\n");
}
