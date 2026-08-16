/**
 * 企微图片消息素材获取：将 PicUrl / media_id 下载为 Data URL，供视觉模型直接分析。
 *
 * 优先级：
 *  1. 直接 fetch 企微回调里的 PicUrl（最快，无需鉴权）
 *  2. 若 PicUrl 需要鉴权/失效，回退走「临时素材下载」接口：
 *     GET {WECHAT_API_BASE_URL}/cgi-bin/media/get?access_token=...&media_id=...
 */
import { env } from "./env";
import { getAccessToken } from "./wechat-client";

const MEDIA_TIMEOUT_MS = 20_000;

/** 将字节 Buffer 编码为 data URL 字符串。 */
function toDataUrl(buf: Buffer, contentType: string | null): string {
  const mime = (contentType ?? "image/png").split(";")[0] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** 优先走 PicUrl 直接下载。 */
async function fetchFromPicUrl(picUrl: string): Promise<string | null> {
  if (!picUrl) return null;
  try {
    const res = await fetch(picUrl, {
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return toDataUrl(buf, res.headers.get("content-type"));
  } catch (e) {
    console.warn("[media] PicUrl 直连下载失败，回退 media/get:", (e as Error).message);
    return null;
  }
}

/** 回退：通过企微临时素材接口下载。 */
async function fetchFromMediaApi(mediaId: string): Promise<string> {
  const token = await getAccessToken();
  const url =
    `${env.wechat.apiBaseUrl}/cgi-bin/media/get` +
    `?access_token=${encodeURIComponent(token)}` +
    `&media_id=${encodeURIComponent(mediaId)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`企微素材下载失败(${res.status}) media_id=${mediaId}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return toDataUrl(buf, res.headers.get("content-type"));
}

/** 下载企微图片消息并转为 Data URL。 */
export async function fetchImageDataUrl(picUrl: string, mediaId?: string): Promise<string> {
  const direct = await fetchFromPicUrl(picUrl);
  if (direct) return direct;
  if (mediaId) return fetchFromMediaApi(mediaId);
  throw new Error("图片消息缺少有效的 PicUrl / MediaId");
}
