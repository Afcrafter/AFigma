/**
 * 企业微信 API 客户端：access_token 获取（带缓存）+ 应用消息发送。
 *
 * API 前缀默认 `https://qyapi.weixin.qq.com`，可通过 `WECHAT_API_BASE_URL`
 * 指向固定 IP 反代，规避 60020（IP 白名单）拦截。
 *
 * 错误处理约定：
 *  - 发送接口返回非 0 errcode（如 60020）→ 抛 WechatApiError（携带 errcode），
 *    明确中断流程，绝不静默吞掉。
 *  - 仅 token 失效类错误码（40014/40001）会刷新 token 重试一次；
 *    其余业务错误不重试、立即抛出。
 *  - 网络/解析异常重试一次，再失败向上抛出。
 */
import { env } from "./env";
import type { WechatSendResult } from "../types/wechat";

/** 企微 API 业务错误：携带 errcode，便于调用方识别与向上反馈。 */
export class WechatApiError extends Error {
  readonly errcode: number;
  readonly errmsg: string;
  readonly raw: unknown;

  constructor(errcode: number, errmsg: string, raw?: unknown) {
    super(`企微接口错误 ${errcode}: ${errmsg}`);
    this.name = "WechatApiError";
    this.errcode = errcode;
    this.errmsg = errmsg;
    this.raw = raw;
  }
}

/** token 失效/凭证错误：刷新 token 后重试一次。 */
const TOKEN_ERRORS = new Set<number>([40014, 40001, 42001]);

let cachedToken: string | null = null;
let cachedExpireAt = 0;

/** 获取企业微信 access_token（模块级缓存 ~7000s，避免每次请求都刷新）。 */
export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cachedToken && now < cachedExpireAt - 60_000) {
    return cachedToken;
  }
  const url =
    `${env.wechat.apiBaseUrl}/cgi-bin/gettoken` +
    `?corpid=${encodeURIComponent(env.wechat.corpid)}` +
    `&corpsecret=${encodeURIComponent(env.wechat.secret)}`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (data.errcode || !data.access_token) {
    throw new WechatApiError(data.errcode ?? -1, data.errmsg ?? "无 access_token", data);
  }
  cachedToken = data.access_token;
  cachedExpireAt = now + (data.expires_in ?? 7200) * 1000;
  return cachedToken;
}

/**
 * 发送应用消息（markdown 类型）。touser 为发起消息的用户 id。
 * 失败时：非 0 errcode 明确抛 WechatApiError 中断；token 失效刷新重试一次。
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getAccessToken(attempt > 0);
      const res = await fetch(
        `${env.wechat.apiBaseUrl}/cgi-bin/message/send?access_token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as WechatSendResult & { errcode?: number };
      const errcode = data.errcode ?? -1;

      if (errcode === 0) return data;

      // token 失效/凭证错误：首次刷新 token 重试一次
      if (TOKEN_ERRORS.has(errcode) && attempt === 0) continue;

      // 其余业务错误（60020 等）或重试后仍失败：明确抛错、中断流程
      throw new WechatApiError(errcode, data.errmsg ?? "unknown", data);
    } catch (e) {
      if (e instanceof WechatApiError) throw e; // 业务错误不重试
      if (attempt === 0) continue; // 网络/解析异常重试一次
      throw e;
    }
  }
  throw new Error("企微消息发送失败（未知原因）");
}
