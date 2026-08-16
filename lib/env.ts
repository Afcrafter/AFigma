/**
 * 环境变量读取与校验。
 * 不在模块顶层 throw（避免 `next build` 因缺 .env 而失败），
 * 通过 `assertEnv()` 在请求处理时校验，缺失时返回明确错误。
 *
 * 命名约定：
 *  - 企业 ID 支持 `WECHAT_CORP_ID`（推荐）与旧名 `WECHAT_CORPID` 兼容读取。
 *  - 企微 API 前缀可用 `WECHAT_API_BASE_URL` 指向固定 IP 反代（规避 60020 白名单拦截），
 *    默认回退到官方域名 `https://qyapi.weixin.qq.com`。
 *  - LLM 优先走 OpenRouter（`OPENROUTER_API_KEY`），亦可使用任意 OpenAI 兼容端点
 *    （`LLM_API_KEY` + `LLM_BASE_URL`）。
 */

/** 企微官方 API 域名（未配置 WECHAT_API_BASE_URL 时的默认值）。 */
const WECHAT_DEFAULT_API_BASE = "https://qyapi.weixin.qq.com";

/** 企微规范要求 EncodingAESKey 固定 43 位（与约 25 位的回调 Token 严格区分）。 */
const AES_KEY_LEN = 43;

export const env = {
  wechat: {
    // 兼容两种命名：推荐 WECHAT_CORP_ID，历史部署可用 WECHAT_CORPID
    corpid: process.env.WECHAT_CORP_ID || process.env.WECHAT_CORPID || "",
    agentId: process.env.WECHAT_AGENT_ID ?? "",
    secret: process.env.WECHAT_SECRET ?? "",
    token: process.env.WECHAT_TOKEN ?? "",
    encodingAESKey: process.env.WECHAT_ENCODING_AES_KEY ?? "",
    apiBaseUrl: process.env.WECHAT_API_BASE_URL || WECHAT_DEFAULT_API_BASE,
  },
  figma: {
    accessToken: process.env.FIGMA_ACCESS_TOKEN ?? "",
    // 可选：Figma API 代理 Base URL（如 VPS 独立 IP 反代），默认官方域名
    apiBaseUrl: process.env.FIGMA_API_BASE_URL || "https://api.figma.com",
  },
  llm: {
    // OpenRouter 优先；兼容自建 OpenAI 兼容端点
    apiKey: process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || "",
    baseURL:
      process.env.LLM_BASE_URL ||
      (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : ""),
    // 模型：OPENROUTER_MODEL 优先，其次 LLM_MODEL，默认 qwen/qwen-2.5-vl-72b-instruct
    model:
      process.env.OPENROUTER_MODEL ||
      process.env.LLM_MODEL ||
      "qwen/qwen-2.5-vl-72b-instruct",
  },
};

/** 返回缺失的环境变量名列表。 */
export function missingEnvVars(): string[] {
  const missing: string[] = [];
  if (!env.wechat.corpid) missing.push("WECHAT_CORP_ID");
  if (!env.wechat.agentId) missing.push("WECHAT_AGENT_ID");
  if (!env.wechat.secret) missing.push("WECHAT_SECRET");
  if (!env.wechat.token) missing.push("WECHAT_TOKEN");
  if (!env.wechat.encodingAESKey) missing.push("WECHAT_ENCODING_AES_KEY");
  if (!env.figma.accessToken) missing.push("FIGMA_ACCESS_TOKEN");
  if (!env.llm.apiKey) missing.push("OPENROUTER_API_KEY / LLM_API_KEY");
  if (!env.llm.baseURL) missing.push("LLM_BASE_URL（或配置 OPENROUTER_API_KEY）");
  if (!env.llm.model) missing.push("LLM_MODEL");
  return missing;
}

/** 校验所有必填环境变量，缺失或格式非法时抛出带明确信息的错误。 */
export function assertEnv(): void {
  const errors: string[] = [];
  const missing = missingEnvVars();
  if (missing.length > 0) {
    errors.push(`缺少环境变量: ${missing.join(", ")}`);
  }
  // 严格区分：EncodingAESKey 必须为固定 43 位，防止和 ~25 位的 Token 混淆后解密失败
  if (env.wechat.encodingAESKey && env.wechat.encodingAESKey.length !== AES_KEY_LEN) {
    errors.push(
      `WECHAT_ENCODING_AES_KEY 长度必须为 ${AES_KEY_LEN} 位（当前 ${env.wechat.encodingAESKey.length} 位），请勿误填回调 Token`
    );
  }
  if (errors.length > 0) {
    throw new Error(errors.join("；") + "。请检查 Vercel 环境变量或 .env.local");
  }
}