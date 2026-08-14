/**
 * 环境变量读取与校验。
 * 不在模块顶层 throw（避免 `next build` 因缺 .env 而失败），
 * 通过 `assertEnv()` 在请求处理时校验，缺失时返回明确错误。
 */

export const env = {
  wechat: {
    corpid: process.env.WECHAT_CORPID ?? "",
    agentId: process.env.WECHAT_AGENT_ID ?? "",
    secret: process.env.WECHAT_SECRET ?? "",
    token: process.env.WECHAT_TOKEN ?? "",
    encodingAESKey: process.env.WECHAT_ENCODING_AES_KEY ?? "",
  },
  figma: {
    accessToken: process.env.FIGMA_ACCESS_TOKEN ?? "",
  },
  llm: {
    apiKey: process.env.LLM_API_KEY ?? "",
    baseURL: process.env.LLM_BASE_URL ?? "",
    model: process.env.LLM_MODEL ?? "",
  },
};

/** 返回缺失的环境变量名列表。 */
export function missingEnvVars(): string[] {
  const missing: string[] = [];
  if (!env.wechat.corpid) missing.push("WECHAT_CORPID");
  if (!env.wechat.agentId) missing.push("WECHAT_AGENT_ID");
  if (!env.wechat.secret) missing.push("WECHAT_SECRET");
  if (!env.wechat.token) missing.push("WECHAT_TOKEN");
  if (!env.wechat.encodingAESKey) missing.push("WECHAT_ENCODING_AES_KEY");
  if (!env.figma.accessToken) missing.push("FIGMA_ACCESS_TOKEN");
  if (!env.llm.apiKey) missing.push("LLM_API_KEY");
  if (!env.llm.baseURL) missing.push("LLM_BASE_URL");
  if (!env.llm.model) missing.push("LLM_MODEL");
  return missing;
}

/** 校验所有必填环境变量，缺失时抛出带明确信息的错误。 */
export function assertEnv(): void {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}。请检查 Vercel 环境变量或 .env.local`);
  }
}
