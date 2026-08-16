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

/**
 * Figma API 基址（代理 Base URL）：通过 FIGMA_API_BASE_URL 可指向 VPS 独立 IP 反代，
 * 破除 Vercel 共享出口 IP 的频控限制；默认回退官方域名。
 */
const FIGMA_BASE_URL = (process.env.FIGMA_API_BASE_URL || "https://api.figma.com").replace(/\/+$/, "");

/* ============ 链接解析 ============ */

/**
 * 解析用户发送的 Figma 链接。
 * 支持：figma.com/file/KEY/name、figma.com/design/KEY/name
 * node-id 支持 0%3A1 / 0:1（冒号）与新版 0-1（连字符，纯数字分隔时转冒号）。
 */
export function parseFigmaUrl(raw: string): FigmaLink | null {
  const m = raw.match(
    /\b(?:https?:\/\/)?(?:www\.)?figma\.com\/(?:file|design)\/([A-Za-z0-9_-]+)/i
  );
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

/** Figma 限流错误：pipeline 识别后给用户友好提示。 */
export class FigmaRateLimitError extends Error {
  constructor(message = "Figma 官方频控中，请等待 1 分钟后再试") {
    super(message);
    this.name = "FigmaRateLimitError";
  }
}

function handleResponse(res: Response, ctx: string): Promise<any> {
  if (res.ok) return res.json() as Promise<any>;
  if (res.status === 403) throw new Error(`Figma 鉴权失败(403)：请检查 FIGMA_ACCESS_TOKEN（${ctx}）`);
  if (res.status === 404) throw new Error(`Figma 资源不存在(404)：${ctx}（文件被删除或无访问权限）`);
  return res.json().catch(() => ({})).then((data) => {
    throw new Error(`Figma 请求失败(${res.status}) ${ctx}: ${JSON.stringify(data).slice(0, 200)}`);
  });
}

/** 429 限流时最多重试次数（含首次请求共发送 1 + MAX_429_RETRIES 次）。 */
const MAX_429_RETRIES = 2;
/** 无 Retry-After 头时默认退避时长（毫秒）：第 1 次 2s、第 2 次 4s。 */
const RETRY_BASE_MS = 2000;
/** Retry-After 超过该秒数则不再重试，直接快速失败（避免占满 Serverless 时长）。 */
const RETRY_MAX_SEC = 10;
/** 单次 Figma 请求超时（毫秒），防止挂起占满 maxDuration。 */
const FIGMA_TIMEOUT_MS = 45_000;

/** 标准请求头：Token / UA / Accept。 */
function figmaHeaders(): Record<string, string> {
  return {
    "X-Figma-Token": env.figma.accessToken,
    "User-Agent": "FigmaWecomBot/1.0 (Node.js/Next.js)",
    Accept: "application/json",
  };
}

/**
 * 带 429 退避重试（最多 2 次）的 Figma 请求：
 *  - Retry-After 超过 10s：不再重试，直接抛 FigmaRateLimitError 快速失败
 *  - 等待阶梯：2s → 4s（base * 2^attempt），累计最多 6s，杜绝 Vercel 挂起
 *  - 每次请求带 AbortSignal 超时，避免挂起
 */
async function figmaFetch(path: string, ctx: string): Promise<any> {
  const url = `${FIGMA_BASE_URL}/v1${path}`;
  console.log("[figma] 发起请求:", url);
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: figmaHeaders(),
      signal: AbortSignal.timeout(FIGMA_TIMEOUT_MS),
    });
    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get("retry-after"));
      // Retry-After 缺失或 ≤10s：按阶梯退避重试
      const canRetry =
        attempt < MAX_429_RETRIES &&
        (!Number.isFinite(retryAfterSec) ||
          retryAfterSec <= RETRY_MAX_SEC ||
          retryAfterSec <= 0);
      if (canRetry) {
        const baseMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000
            : RETRY_BASE_MS;
        const delayMs = Math.min(baseMs, 10_000) * 2 ** attempt;
        console.warn(`[figma] 429 限流，${delayMs}ms 后第 ${attempt + 1} 次重试（${ctx}）`);
        await sleep(delayMs);
        continue;
      }
      // 重试耗尽或 Retry-After > 10s：快速失败
      throw new FigmaRateLimitError();
    }
    return handleResponse(res, ctx);
  }
  throw new Error(`Figma 接口持续 429 限流（已重试 ${MAX_429_RETRIES} 次）：${ctx}`);
}

/* ============ 短期 TTL 缓存（杜绝高频调试触发风控） ============ */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** 简单 TTL 缓存：相同 fileKey+nodeId 的元数据 / 切图在 TTL 内直接命中，不再请求 Figma。 */
function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      // 懒清理：仅当条目超阈值时扫描清除过期项，防止内存无限增长
      if (store.size > 500) {
        for (const [k, e] of store) {
          if (Date.now() >= e.expiresAt) store.delete(k);
        }
      }
    },
    clear(): void {
      store.clear();
    },
  };
}

/** 元数据 / 切图导出 / Design Tokens 短期缓存，TTL 5 分钟。 */
const CACHE_TTL_MS = 300_000;
const metadataCache = createTtlCache<FigmaNodeInfo>(CACHE_TTL_MS);
const exportCache = createTtlCache<FigmaExport>(CACHE_TTL_MS);
const tokensCache = createTtlCache<FigmaDesignTokens>(CACHE_TTL_MS);

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
  const cacheKey = `metadata:${fileKey}:${nodeId}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

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
  const info: FigmaNodeInfo = {
    nodeId,
    name: doc.name ?? "",
    type: doc.type,
    width: doc.absoluteBoundingBox?.width,
    height: doc.absoluteBoundingBox?.height,
    fillColors: [...new Set(acc.fills)].slice(0, 12),
    fonts: [...new Set(acc.fonts)].slice(0, 8),
    childCount: doc.children?.length ?? 0,
  };
  metadataCache.set(cacheKey, info);
  return info;
}

/** 获取文件 Design Tokens（颜色 / 排版变量），按 fileKey 走 TTL 缓存。 */
export async function getDesignTokens(fileKey: string): Promise<FigmaDesignTokens> {
  const cacheKey = `tokens:${fileKey}`;
  const cached = tokensCache.get(cacheKey);
  if (cached) return cached;

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
  const result: FigmaDesignTokens = {
    colors: colors.slice(0, 12),
    typography: typography.slice(0, 12),
  };
  tokensCache.set(cacheKey, result);
  return result;
}

/** 导出节点高清 PNG（scale=2）。返回图片 URL（签名约 30 分钟有效）。 */
export async function exportImage(fileKey: string, nodeId: string): Promise<FigmaExport> {
  const cacheKey = `export:${fileKey}:${nodeId}`;
  const cached = exportCache.get(cacheKey);
  if (cached) return cached;

  const q = `ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
  const data = await figmaFetch(`/images/${fileKey}?${q}`, `export node=${nodeId}`);
  const url = data?.images?.[nodeId];
  if (!url) throw new Error(`Figma 切图导出失败（未返回图片 URL）：${nodeId}`);
  const result: FigmaExport = { nodeId, imageUrl: url, format: "png" };
  exportCache.set(cacheKey, result);
  return result;
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
