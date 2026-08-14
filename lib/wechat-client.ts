/**
 * 企业微信 API 客户端：access_token 获取（带缓存）+ 应用消息发送。
 */
import { env } from "./env";
import type { WechatSendResult } from "../types/wechat";

const WECHAT_BASE = "https://qyapi.weixin.qq.com";

let cachedToken: string | null = null;
let cachedExpireAt = 0;

/** 获取企业微信 access_token（模块级缓存 ~7000s，避免每次请求都刷新）。 */
export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cachedToken && now < cachedExpireAt - 60_000) {
    return cachedToken;
  }
  const url =
    `${WECHAT_BASE}/cgi-bin/gettoken` +
    `?corpid=${encodeURIComponent(env.wechat.corpid)}` +
    `&corpsecret=${encodeURIComponent(env.wechat.secret)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (data.errcode || !data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }
  cachedToken = data.access_token;
  cachedExpireAt = now + (data.expires_in ?? 7200) * 1000;
  return cachedToken;
}

/**
 * 发送应用消息（markdown 类型）。touser 为发起消息的用户 id。
 * 失败时重试 1 次（强制刷新 token 后再试）。
 */
export async function sendMarkdown(
  touser: string,
  content: string
): Promise<WechatSendResult> {
  const payload = {
    touser,
    msgtype: "markdown",
    agentid: Number(env.wechat.agentId) || env.wechat.agentId,
    markdown: { content },
    safe: 0,
  };
  return sendWithRetry(payload);
}

async function sendWithRetry(
  payload: Record<string, unknown>
): Promise<WechatSendResult> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getAccessToken(attempt > 0);
      const res = await fetch(`${WECHAT_BASE}/cgi-bin/message/send?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as WechatSendResult & { errcode?: number };
      if (data.errcode === 0) return data;
      // 40014 = token 失效，刷新后重试；40001 = 凭证无效
      if (data.errcode === 40014 || data.errcode === 40001) {
        lastErr = new Error(`企微发送失败 ${data.errcode}: ${data.errmsg}`);
        continue;
      }
      throw new Error(`企微发送失败 ${data.errcode}: ${data.errmsg}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("企微发送失败");
}
