/**
 * 企业微信「接收消息」加解密（WXBizMsgCrypt 协议）实现。
 * 使用 Node 标准 crypto，无第三方依赖。
 *
 * 协议要点：
 *  - 签名：SHA1( sort([token, timestamp, nonce, encrypt]).join("") )
 *  - AESKey：EncodingAESKey(43 位 base64) 补 "=" 后解码 → 32 字节
 *  - IV：固定为 AESKey 前 16 字节
 *  - 明文布局：random(16) + msgLen(4 字节大端) + msg + corpid
 *  - 填充：AES-256-CBC + PKCS7（手动，块大小 32）
 */
import crypto from "node:crypto";

/** 由 43 位 EncodingAESKey 派生 32 字节 AES 密钥。 */
export function deriveAesKey(encodingAESKey: string): Buffer {
  if (encodingAESKey.length !== 43) {
    throw new Error(
      `EncodingAESKey 长度必须为 43 位（当前 ${encodingAESKey.length}），请检查企业微信配置`
    );
  }
  const key = Buffer.from(encodingAESKey + "=", "base64");
  if (key.length !== 32) {
    throw new Error("EncodingAESKey 解码后必须为 32 字节，请检查是否为有效的 base64");
  }
  return key;
}

/** 恒时比较两个字符串，防时序侧信道。 */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export interface SignatureParams {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  signature: string;
}

/** 校验企微消息签名：SHA1(sort([token,timestamp,nonce,encrypt]).join(""))。 */
export function verifySignature(p: SignatureParams): boolean {
  if (!p.encrypt || !p.signature) return false;
  const raw = [p.token, p.timestamp, p.nonce, p.encrypt].sort().join("");
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return safeEqualHex(hash.toLowerCase(), p.signature.toLowerCase());
}

/** PKCS7 填充（块大小 32）。 */
function pkcs7Pad(buf: Buffer): Buffer {
  const blockSize = 32;
  const padLen = blockSize - (buf.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buf, pad]);
}

/** PKCS7 去填充（校验合法性）。 */
function pkcs7Unpad(buf: Buffer): Buffer {
  if (buf.length === 0) throw new Error("解密结果为空");
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32 || pad > buf.length) {
    throw new Error("非法 PKCS7 填充");
  }
  return buf.subarray(0, buf.length - pad);
}

/** 加密企业微信消息，返回 base64。 */
export function encrypt(encodingAESKey: string, plainText: string, corpid: string): string {
  const aesKey = deriveAesKey(encodingAESKey);
  const random = crypto.randomBytes(16);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(Buffer.byteLength(plainText, "utf8"), 0);
  const raw = Buffer.concat([
    random,
    lenBuf,
    Buffer.from(plainText, "utf8"),
    Buffer.from(corpid, "utf8"),
  ]);
  const padded = pkcs7Pad(raw);
  const iv = aesKey.subarray(0, 16);
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(padded), cipher.final()]);
  return out.toString("base64");
}

/** 解密企业微信消息密文，返回明文。校验尾部 corpid。 */
export function decrypt(encodingAESKey: string, encryptedB64: string, corpid: string): string {
  const aesKey = deriveAesKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  let buf: Buffer;
  try {
    buf = Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, "base64")),
      decipher.final(),
    ]);
  } catch (e) {
    throw new Error(`AES 解密失败: ${(e as Error).message}`);
  }
  buf = pkcs7Unpad(buf);
  if (buf.length < 20) throw new Error("解密结果长度异常");
  const msgLen = buf.readUInt32BE(16);
  if (20 + msgLen > buf.length) throw new Error("解密结果长度与消息长度不符");
  const msg = buf.subarray(20, 20 + msgLen).toString("utf8");
  const receiveId = buf.subarray(20 + msgLen).toString("utf8");
  if (receiveId !== corpid) {
    throw new Error("解密 receiveid 与 corpid 不匹配（可能是 AESKey 或 corpid 配置错误）");
  }
  return msg;
}
