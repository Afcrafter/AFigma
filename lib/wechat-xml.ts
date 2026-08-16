/**
 * 企业微信回调体解析与消息归一化。
 * 兼容两种回调格式：
 *  1) 加密/明文 XML（<xml> 包裹，Encrypt 字段 CDATA）
 *  2) JSON（企微可选配置，body 以 { 开头）
 */
import type { NormalizedWechatMessage } from "../types/wechat";

/** 提取单个 XML 标签内容（兼容 CDATA 与纯文本）。 */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))?<\\/${tag}>`
  );
  const m = xml.match(re);
  if (!m) return "";
  return (m[1] ?? m[2] ?? "").trim();
}

export interface CallbackBody {
  /** 密文（安全模式）；明文模式下为空 */
  encrypt: string;
  /** 明文内容（未加密的 XML/JSON body） */
  plaintext: string;
}

/**
 * 解析回调请求体，判断是加密模式（含 Encrypt）还是明文模式。
 * @param body 原始请求体字符串
 * @param contentType 请求 Content-Type
 */
export function parseCallbackBody(body: string, contentType = ""): CallbackBody {
  const trimmed = body.trim();
  const isJson =
    contentType.includes("application/json") || trimmed.startsWith("{");

  if (isJson) {
    // JSON 模式
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      const encrypt = typeof data.Encrypt === "string" ? (data.Encrypt as string) : "";
      return { encrypt, plaintext: trimmed };
    } catch {
      return { encrypt: "", plaintext: trimmed };
    }
  }

  // XML 模式
  const encrypt = extractTag(trimmed, "Encrypt");
  return { encrypt, plaintext: trimmed };
}

/**
 * 将解密的明文（XML 或 JSON）归一化为统一消息结构。
 */
export function normalizePlaintext(plaintext: string): NormalizedWechatMessage {
  const trimmed = plaintext.trim();
  if (trimmed.startsWith("{")) {
    return normalizeJson(trimmed);
  }
  return normalizeXml(trimmed);
}

function normalizeXml(xml: string): NormalizedWechatMessage {
  return {
    msgId: extractTag(xml, "MsgId"),
    toUserName: extractTag(xml, "ToUserName"),
    fromUserName: extractTag(xml, "FromUserName"),
    msgType: extractTag(xml, "MsgType"),
    content: extractTag(xml, "Content"),
    createTime: extractTag(xml, "CreateTime"),
    event: extractTag(xml, "Event"),
    picUrl: extractTag(xml, "PicUrl"),
    mediaId: extractTag(xml, "MediaId"),
    raw: xml,
  };
}

function normalizeJson(json: string): NormalizedWechatMessage {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {
      msgId: "",
      toUserName: "",
      fromUserName: "",
      msgType: "",
      content: "",
      raw: json,
    };
  }
  const str = (v: unknown): string =>
    v == null ? "" : String(v);
  return {
    msgId: str(data.MsgId),
    toUserName: str(data.ToUserName),
    fromUserName: str(data.FromUserName),
    msgType: str(data.MsgType),
    content: str(data.Content),
    createTime: str(data.CreateTime),
    event: str(data.Event),
    picUrl: str(data.PicUrl),
    mediaId: str(data.MediaId),
    raw: json,
  };
}

/** 生成密文模式回调的加密 XML 外层（供 encrypt 后包裹）。 */
export function wrapEncryptedXml(encrypt: string, signature: string, timestamp: string, nonce: string): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<xml>
  <Encrypt><![CDATA[${esc(encrypt)}]]></Encrypt>
  <MsgSignature><![CDATA[${esc(signature)}]]></MsgSignature>
  <TimeStamp>${timestamp}</TimeStamp>
  <Nonce><![CDATA[${esc(nonce)}]]></Nonce>
</xml>`;
}
