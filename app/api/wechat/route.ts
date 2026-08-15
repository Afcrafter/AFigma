/**
 * 企业微信消息网关入口。
 *  - GET：URL 验证握手（验签 + 解密 echostr，返回明文）
 *  - POST：接收消息（验签 + 解密 → 归一化），立即返回 success，用 waitUntil() 后台跑分析流水线
 *
 * 时序约束：企微要求回调在 5 秒内返回，否则重试。AI 分析 30-60s，
 * 故必须「秒回 success + 后台 waitUntil() 处理 + 应用消息推送结果」。
 */
import { waitUntil } from "@vercel/functions";
import { env } from "../../../lib/env";
import { verifySignature, decrypt } from "../../../lib/wechat-crypto";
import { parseCallbackBody, normalizePlaintext } from "../../../lib/wechat-xml";
import { runPipeline } from "../../../lib/pipeline";
import { parseFigmaUrl } from "../../../lib/figma";

// 后台任务在 Node runtime 运行；maxDuration 为后台任务提供预算（Vercel Fluid: Hobby 300s / Pro 800s）
export const runtime = "nodejs";
export const maxDuration = 120;

/** 同实例 MsgId 去重，防企微重试导致重复处理。 */
const recentMsgIds = new Set<string>();
function isDuplicate(msgId: string): boolean {
  if (!msgId) return false;
  if (recentMsgIds.has(msgId)) return true;
  recentMsgIds.add(msgId);
  if (recentMsgIds.size > 1000) recentMsgIds.clear();
  return false;
}

function wechatEnvReady(): boolean {
  return Boolean(
    env.wechat.corpid && env.wechat.token && env.wechat.encodingAESKey
  );
}

/** GET：企业微信后台 URL 验证（安全模式）。 */
export async function GET(req: Request): Promise<Response> {
  if (!wechatEnvReady()) {
    return new Response("env error", { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";
  const echostr = searchParams.get("echostr") ?? "";
  const signature = searchParams.get("msg_signature") ?? "";

  if (!verifySignature({ token: env.wechat.token, timestamp, nonce, encrypt: echostr, signature })) {
    return new Response("signature error", { status: 403 });
  }
  try {
    const plain = decrypt(env.wechat.encodingAESKey, echostr, env.wechat.corpid);
    return new Response(plain, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error("[wechat] echostr 解密失败:", (e as Error).message);
    return new Response("decrypt error", { status: 403 });
  }
}

/** POST：接收企微用户/群聊消息。 */
export async function POST(req: Request): Promise<Response> {
  let timestamp = "";
  let nonce = "";
  let signature = "";
  let encrypt = "";
  let plaintext = "";

  try {
    const { searchParams } = new URL(req.url);
    timestamp = searchParams.get("timestamp") ?? "";
    nonce = searchParams.get("nonce") ?? "";
    signature = searchParams.get("msg_signature") ?? "";
    const raw = await req.text();
    const parsed = parseCallbackBody(raw, req.headers.get("content-type") ?? "");
    encrypt = parsed.encrypt;
    plaintext = parsed.plaintext;
  } catch (e) {
    console.error("[wechat] 解析请求体失败:", (e as Error).message);
    return new Response("bad request", { status: 400 });
  }

  let msgText: string;
  if (encrypt) {
    // 加密模式：先验签后解密（防 padding oracle）
    if (!wechatEnvReady()) {
      return new Response("env error", { status: 500 });
    }
    if (!verifySignature({ token: env.wechat.token, timestamp, nonce, encrypt, signature })) {
      return new Response("signature error", { status: 403 });
    }
    try {
      msgText = decrypt(env.wechat.encodingAESKey, encrypt, env.wechat.corpid);
    } catch (e) {
      console.error("[wechat] 消息解密失败:", (e as Error).message);
      return new Response("decrypt error", { status: 403 });
    }
  } else {
    msgText = plaintext;
  }

  const msg = normalizePlaintext(msgText);

  // 仅文本消息进入处理；去重防重试
  if (msg.msgType === "text" && msg.content && !isDuplicate(msg.msgId)) {
    // 是否含 Figma 链接（用于日志/过滤，pipeline 内部同样会判断）
    const hasFigma = parseFigmaUrl(msg.content) !== null;
    console.info(
      `[wechat] 收到消息 user=${msg.fromUserName} hasFigma=${hasFigma} len=${msg.content.length}`
    );
    // Vercel 专用后台任务：记录 pipeline 成功/失败状态
    waitUntil(
      runPipeline(msg)
        .then((ok) => console.info(`[wechat] pipeline 完成 ok=${ok}`))
        .catch((e) => console.error("[wechat] pipeline 异常:", e))
    );
  }

  // 立即回包 success（显式 200），满足企微 5 秒回包约束，
  // 防止云端实例等待超时提前挂起，切断 waitUntil 后台流程
  return new Response("success", { status: 200 });
}
