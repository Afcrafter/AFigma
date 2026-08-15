/**
 * 生成企业微信回调加密报文（用于本地自测 GET 握手 + POST 解密）。
 * 运行：npm run test:crypto
 *
 * 若 .env.local 已配置真实值则使用真实值；否则使用内置测试值，
 * 并把「应填到 .env.local」的提示打印出来。
 */
import crypto from "node:crypto";
import { encrypt, decrypt, verifySignature, deriveAesKey } from "../lib/wechat-crypto";
import { env } from "../lib/env";

// 测试用固定值（保证 43 位 base64、解码 32 字节）
const TEST_AES_KEY = "0123456789abcdef0123456789abcdef0123456789a";
const TEST_CORPID = "wwtestcorpid001";
const TEST_TOKEN = "testtoken";

const aesKey = env.wechat.encodingAESKey || TEST_AES_KEY;
const corpid = env.wechat.corpid || TEST_CORPID;
const token = env.wechat.token || TEST_TOKEN;

// 校验测试 key 可用
try {
  deriveAesKey(aesKey);
} catch (e) {
  console.error("AES Key 无效:", (e as Error).message);
  process.exit(1);
}

const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = crypto.randomBytes(8).toString("hex");

const plainXml = `<xml>
  <ToUserName><![CDATA[${corpid}]]></ToUserName>
  <FromUserName><![CDATA[user_test001]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[帮我分析 https://www.figma.com/design/abc123/测试页面?node-id=0%3A1]]></Content>
  <MsgId>${Date.now()}1</MsgId>
  <AgentID>1000002</AgentID>
</xml>`;

const encryptB64 = encrypt(aesKey, plainXml, corpid);

// 往返验证
const decrypted = decrypt(aesKey, encryptB64, corpid);
const roundtripOk = decrypted === plainXml;

// GET 握手验签
const sorted = [token, timestamp, nonce, encryptB64].sort().join("");
const sig = crypto.createHash("sha1").update(sorted).digest("hex");
const sigOk = verifySignature({ token, timestamp, nonce, encrypt: encryptB64, signature: sig });

console.log("==============================================");
console.log("企业微信回调自测报文");
console.log("==============================================");
if (!env.wechat.encodingAESKey) {
  console.log("⚠️  未检测到 .env.local，使用内置测试值。请把以下配置写入 .env.local：\n");
  console.log(`WECHAT_CORP_ID=${TEST_CORPID}`);
  console.log(`WECHAT_TOKEN=${TEST_TOKEN}`);
  console.log(`WECHAT_ENCODING_AES_KEY=${TEST_AES_KEY}`);
  console.log("");
}

console.log("【1】加解密往返: ", roundtripOk ? "✅ 通过" : "❌ 失败");
console.log("【2】签名验证:   ", sigOk ? "✅ 通过" : "❌ 失败");
console.log("");

console.log("【3】GET 握手 URL（粘贴到浏览器验证返回明文 XML）:");
console.log(
  `http://localhost:3000/api/wechat?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}&echostr=${encodeURIComponent(encryptB64)}`
);
console.log("");

console.log("【4】POST 回调报文（curl 用，安全模式加密 XML）:");
console.log(
  `curl -X POST "http://localhost:3000/api/wechat?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}" -H "Content-Type: application/xml" -d '${wrapXml(encryptB64, sig, timestamp, nonce)}'`
);
console.log("");

if (!roundtripOk || !sigOk) {
  console.error("自测失败");
  process.exit(1);
}

function wrapXml(enc: string, signature: string, ts: string, n: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<xml><Encrypt><![CDATA[${esc(enc)}]]></Encrypt><MsgSignature><![CDATA[${esc(signature)}]]></MsgSignature><TimeStamp>${ts}</TimeStamp><Nonce><![CDATA[${esc(n)}]]></Nonce></xml>`;
}
