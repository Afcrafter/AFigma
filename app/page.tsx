import { env, missingEnvVars } from "../lib/env";

export const dynamic = "force-dynamic";

/** 掩码显示密钥，避免泄露完整值。 */
function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "***";
  return `${v.slice(0, 3)}****${v.slice(-3)}`;
}

export default function Home() {
  const missing = missingEnvVars();
  const rows: [string, string, boolean][] = [
    ["WECHAT_CORP_ID", mask(env.wechat.corpid), !!env.wechat.corpid],
    ["WECHAT_AGENT_ID", env.wechat.agentId, !!env.wechat.agentId],
    ["WECHAT_SECRET", mask(env.wechat.secret), !!env.wechat.secret],
    ["WECHAT_TOKEN", mask(env.wechat.token), !!env.wechat.token],
    ["WECHAT_ENCODING_AES_KEY", mask(env.wechat.encodingAESKey), !!env.wechat.encodingAESKey],
    ["WECHAT_API_BASE_URL", env.wechat.apiBaseUrl, true],
    ["FIGMA_ACCESS_TOKEN", mask(env.figma.accessToken), !!env.figma.accessToken],
    ["OPENROUTER_API_KEY / LLM_API_KEY", mask(env.llm.apiKey), !!env.llm.apiKey],
    ["LLM_BASE_URL", env.llm.baseURL, !!env.llm.baseURL],
    ["LLM_MODEL", env.llm.model, !!env.llm.model],
  ];

  const ok = missing.length === 0;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>
        企业微信 + Figma 设计分析网关
      </h1>
      <p style={{ color: "#555" }}>
        在企微里发送 Figma 链接，自动导出画板并调用视觉模型分析，结果以 Markdown 回推。
      </p>

      <section
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 12,
          border: `1px solid ${ok ? "#22c55e" : "#f59e0b"}`,
          background: ok ? "#f0fdf4" : "#fffbeb",
        }}
      >
        <strong>{ok ? "✅ 环境变量已就绪" : `⚠️ 缺少环境变量：${missing.join(", ")}`}</strong>
      </section>

      <table style={{ marginTop: 20, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={{ padding: "8px 12px", borderBottom: "2px solid #e5e7eb" }}>变量</th>
            <th style={{ padding: "8px 12px", borderBottom: "2px solid #e5e7eb" }}>值</th>
            <th style={{ padding: "8px 12px", borderBottom: "2px solid #e5e7eb" }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v, set]) => (
            <tr key={k}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>
                {k}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace", color: "#666" }}>
                {v || "—"}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6" }}>
                {set ? "✅" : "❌"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ marginTop: 24, padding: 16, background: "#f9fafb", borderRadius: 12 }}>
        <strong>用法</strong>
        <ol style={{ marginTop: 8, lineHeight: 1.8 }}>
          <li>在企业微信后台配置回调 URL（安全模式）：<code>/api/wechat</code></li>
          <li>在企业微信里向应用发送 Figma 链接（可带 <code>?node-id=</code>）</li>
          <li>稍候收到：界面层级 / 主色调 / 可用性评分 / Tailwind+React 代码 / 高清切图链接</li>
        </ol>
        <p style={{ color: "#666", fontSize: 13 }}>
          健康检查：<code>/api/health</code>
        </p>
      </section>
    </main>
  );
}
