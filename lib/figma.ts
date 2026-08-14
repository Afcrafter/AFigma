/**
 * Figma 链接解析 + REST API 客户端。
 * 统一使用 X-Figma-Token 请求头，包含 429 退避重试与错误归类。
 */
import { env } from "./env";
import type {
  FigmaDesignTokens,
  FigmaExport,
  FigmaLink,
  FigmaNodeInfo,
} from "../types/wechat";

const FIGMA_BASE = "https://api.figma.com/v1";

/* ============ 链接解析 ============ */

/**
 * 解析用户发送的 Figma 链接。
 * 支持：figma.com/file/KEY/name、figma.com/design/KEY/name
 * node-id 支持 0%3A1 / 0:1（冒号）与新版 0-1（连字符，纯数字分隔时转冒号）。
 */
export function parseFigmaUrl(raw: string): FigmaLink | null {
  const m = raw.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9_-]+)/i);
  if (!m) return null;
  const fileKey = m[1];
  const query = raw.split("?")[1] ?? "";
  let nodeId: string | undefined;
  for (const part of query.split("&")) {
    if (part.startsWith("node-id=")) {
      try {
        nodeId = decodeURIComponent(part.slice(8));
      } catch {
        nodeId = part.slice(8);
      }
      break;
    }
  }
  if (nodeId && /^\d+-\d+/.test(nodeId)) {
    // 新版 node-id 使用连字符分隔（如 1234-5678），Figma API 需要冒号
    nodeId = nodeId.replace(/-/g, ":");
  }
  return { fileKey, nodeId };
}

/* ============ 内部工具 ============ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const to = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

function handleResponse(res: Response, ctx: string): Promise<any> {
  if (res.ok) return res.json() as Promise<any>;
  if (res.status === 403) throw new Error(`Figma 鉴权失败(403)：请检查 FIGMA_ACCESS_TOKEN（${ctx}）`);
  if (res.status === 404) throw new Error(`Figma 资源不存在(404)：${ctx}（文件被删除或无访问权限）`);
  if (res.status === 429) throw new Error(`Figma 请求过于频繁(429)：${ctx}`);
  return res.json().catch(() => ({})).then((data) => {
    throw new Error(`Figma 请求失败(${res.status}) ${ctx}: ${JSON.stringify(data).slice(0, 200)}`);
  });
}

/** 带 429 退避重试（1 次）的 Figma 请求。 */
async function figmaFetch(path: string, ctx: string): Promise<any> {
  const url = `${FIGMA_BASE}${path}`;
  const headers = { "X-Figma-Token": env.figma.accessToken };
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "2");
    await sleep(Math.max(1, Math.min(retryAfter, 5)) * 1000);
    const res2 = await fetch(url, { headers });
    return handleResponse(res2, ctx);
  }
  return handleResponse(res, ctx);
}

/* ============ REST API ============ */

/** 递归收集节点内 solid 填充色与字体。 */
function collectStyle(node: any, acc: { fills: string[]; fonts: string[] }): void {
  if (node?.fills?.length) {
    for (const f of node.fills) {
      if (f?.type === "SOLID" && f.color && typeof f.color.r === "number") {
        acc.fills.push(rgbToHex(f.color));
      }
    }
  }
  if (node?.style?.fontFamily) {
    acc.fonts.push(node.style.fontFamily);
  }
  if (node?.children?.length) {
    for (const c of node.children) collectStyle(c, acc);
  }
}

/** 获取指定节点的元数据（名称、尺寸、颜色、字体、子节点数）。 */
export async function getNodeMetadata(
  fileKey: string,
  nodeId: string
): Promise<FigmaNodeInfo> {
  const data = await figmaFetch(
    `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
    `file=${fileKey} node=${nodeId}`
  );
  const nodeEntry = data?.nodes?.[nodeId];
  const doc = nodeEntry?.document;
  if (!doc) {
    throw new Error(`Figma 节点不存在：${nodeId}`);
  }
  const acc = { fills: [] as string[], fonts: [] as string[] };
  collectStyle(doc, acc);
  return {
    nodeId,
    name: doc.name ?? "",
    type: doc.type,
    width: doc.absoluteBoundingBox?.width,
    height: doc.absoluteBoundingBox?.height,
    fillColors: [...new Set(acc.fills)].slice(0, 12),
    fonts: [...new Set(acc.fonts)].slice(0, 8),
    childCount: doc.children?.length ?? 0,
  };
}

/** 获取文件 Design Tokens（颜色 / 排版变量）。 */
export async function getDesignTokens(fileKey: string): Promise<FigmaDesignTokens> {
  const data = await figmaFetch(
    `/files/${fileKey}/variables/local`,
    `variables file=${fileKey}`
  );
  const variables = data?.meta?.variables ?? {};
  const colors: FigmaDesignTokens["colors"] = [];
  const typography: FigmaDesignTokens["typography"] = [];
  for (const v of Object.values<any>(variables)) {
    if (!v?.resolvedType || !v?.valuesByMode) continue;
    const firstVal = Object.values<any>(v.valuesByMode)[0];
    if (v.resolvedType === "COLOR" && firstVal && typeof firstVal.r === "number") {
      colors.push({ name: v.name, value: rgbToHex(firstVal) });
    } else if (v.resolvedType === "FLOAT" && /font|size|spacing|line/i.test(v.name)) {
      typography.push({ name: v.name, value: String(firstVal) });
    }
  }
  return { colors: colors.slice(0, 12), typography: typography.slice(0, 12) };
}

/** 导出节点高清 PNG（scale=2）。返回图片 URL（签名约 30 分钟有效）。 */
export async function exportImage(fileKey: string, nodeId: string): Promise<FigmaExport> {
  const q = `ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
  const data = await figmaFetch(`/images/${fileKey}?${q}`, `export node=${nodeId}`);
  const url = data?.images?.[nodeId];
  if (!url) throw new Error(`Figma 切图导出失败（未返回图片 URL）：${nodeId}`);
  return { nodeId, imageUrl: url, format: "png" };
}

/**
 * 解析要分析的目标节点：有 node-id 用 node-id；没有则取文件首个 Canvas 下的首个 Frame，
 * 保证用户只发文件链接时也能分析到实际页面。
 */
export async function resolveTargetNodeId(
  fileKey: string,
  nodeId?: string
): Promise<{ fileKey: string; nodeId: string }> {
  if (nodeId) return { fileKey, nodeId };
  const data = await figmaFetch(`/files/${fileKey}?depth=1`, `file=${fileKey}`);
  const doc = data?.document;
  const canvas = doc?.children?.[0];
  const frame = canvas?.children?.[0];
  const id = frame?.id ?? canvas?.id ?? doc?.id;
  if (!id) throw new Error("Figma 文件没有可分析的画板节点，请提供 node-id");
  return { fileKey, nodeId: id };
}
