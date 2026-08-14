/**
 * 端到端自测：直接向本地 dev server 的 /api/wechat 发起 GET 握手 + POST 回调。
 * 前提：已启动 `npm run dev`，且 .env.local 使用了本脚本相同的测试值。
 * 运行：tsx scripts/e2e-wechat.test.ts
 */
import crypto from "node:crypto";
import { encrypt } from "../lib/wechat-crypto";

const BASE = "http://localhost:3000/api/wechat";

// 与 .env.local / make-callback 一致的测试值
const aesKey = "0123456789abcdef0123456789abcdef0123456789a";
const corpid = "wwtestcorpid001";
const token = "testtoken";

function sign(enc: string, timestamp: string, nonce: string): string {
  return crypto
    .createHash("sha1")
    .update([token, timestamp, nonce, enc].sort().join(""))
    .digest("hex");
}

async function main(): Promise<void> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString("hex");
  const plainXml = `<xml>
  <ToUserName><![CDATA[${corpid}]]></ToUserName>
  <FromUserName><![CDATA[user_test001]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[帮我分析 https://www.figma.com/design/abc123/测试?node-id=0%3A1]]></Content>
  <MsgId>${Date.now()}11</MsgId>
  <AgentID>1000002</AgentID>
</xml>`;

  const enc = encrypt(aesKey, plainXml, corpid);
  const sig = sign(enc, timestamp, nonce);

  // ---- 1. GET 握手 ----
  const getUrl = `${BASE}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}&echostr=${encodeURIComponent(enc)}`;
  console.log("=== GET 握手 ===");
  try {
    const r = await fetch(getUrl);
    const body = await r.text();
    console.log("HTTP", r.status);
    const ok = r.status === 200 && body === plainXml;
    console.log("返回明文 === 原文:", ok ? "✅" : "❌");
    if (!ok) console.log("期望:", plainXml, "\n实际:", body);
  } catch (e) {
    console.log("GET 请求异常:", (e as Error).message);
  }

  // ---- 2. POST 回调（加密 XML）----
  const postBody = `<xml><Encrypt><![CDATA[${enc}]]></Encrypt><MsgSignature><![CDATA[${sig}]]></MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
  const postUrl = `${BASE}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`;
  console.log("\n=== POST 回调 ===");
  try {
    const r = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: postBody,
    });
    const body = await r.text();
    console.log("HTTP", r.status, "→", JSON.stringify(body));
    console.log("返回 success:", body === "success" ? "✅" : "❌");
  } catch (e) {
    console.log("POST 请求异常:", (e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
