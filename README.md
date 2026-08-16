# 企业微信 + Figma 自动化互联与设计分析网关

在企业微信里发送一个 **Figma 链接**，或直接 **粘贴画板截图（Ctrl+V）** → 调用**多模态视觉大模型**分析界面 → 把「界面层级 / 主色调 / 可用性评分 / Tailwind + React 代码 / 高清切图链接」以 **Markdown 卡片**回推给你。

- **Figma 链接**：走 Figma API 导出高清切图后分析；若遭遇频控（429），会提示你改发截图秒级分析。
- **画板截图**：直连视觉模型分析，**完全绕过 Figma API**，不受限流影响。

部署于 **Vercel**（Next.js App Router + TypeScript）。

## 工作流程

```
企微用户发 Figma 链接
   │
   ▼
企微回调 POST ──验签→ 解密 → 提取链接
   │                 │
   │  立即返回 success（满足 5 秒约束）   waitUntil() 后台保活
   ▼
   ┌────────────────────────────────────────────┐
   │ Figma API（X-Figma-Token）                  │
   │   · 节点元数据 / Design Tokens              │
   │   · /v1/images 导出高清 PNG                 │
   │        │                                    │
   │        ▼                                    │
   │ 多模态 LLM（OpenAI 兼容端点，需支持图片）     │
   │   · 分析层级/配色/可用性                     │
   │   · 生成 Tailwind / React 代码              │
   │        │                                    │
   │        ▼                                    │
   │ 企微应用消息（msgtype=markdown）回推         │
   └────────────────────────────────────────────┘
```

## 环境变量

复制 `.env.example` 为 `.env.local` 并填写（Vercel 部署时在控制台配置同名变量）：

| 变量 | 说明 |
|------|------|
| `WECHAT_CORP_ID` | 企业 ID（管理后台 → 我的企业；旧名 `WECHAT_CORPID` 仍兼容） |
| `WECHAT_AGENT_ID` | 自建应用 AgentId |
| `WECHAT_SECRET` | 应用 Secret |
| `WECHAT_TOKEN` | 回调验证 Token（约 25 位随机串） |
| `WECHAT_ENCODING_AES_KEY` | 回调加解密 Key（**固定 43 位** base64，无等号） |
| `WECHAT_API_BASE_URL` | （可选）企微 API 前缀，默认 `https://qyapi.weixin.qq.com`；触发 60020 时指向固定 IP 反代 |
| `FIGMA_ACCESS_TOKEN` | Figma 个人访问令牌 |
| `OPENROUTER_API_KEY` | OpenRouter API Key（与 `LLM_API_KEY` 二选一） |
| `LLM_API_KEY` | （可选）自建 OpenAI 兼容端点 API Key |
| `LLM_BASE_URL` | （可选）OpenAI 兼容端点 Base URL |
| `LLM_MODEL` | **必须选择支持图片输入的视觉模型**，推荐 `google/gemini-2.0-flash-001`（或 qwen-2.5-vl） |

> ⚠️ 托管的 DeepSeek API 只支持文本、不支持图片，无法用于 UI 设计图分析，请勿选择。
> 若配置的模型不支持 `image_url`，分析会失败并在企微里收到明确报错提示。
> 配置 `OPENROUTER_API_KEY` 时无需再填 `LLM_BASE_URL`（自动指向 `https://openrouter.ai/api/v1`）。

## 本地开发

```bash
npm install
npm run dev
```

自测：

```bash
npm run test:parse      # Figma 链接解析 8 种形态
npm run test:crypto     # 加解密往返 + 生成 GET/POST 自测报文
npm run typecheck       # TypeScript 类型检查
npm run build           # 生产构建
```

本地验证回调：先 `npm run test:crypto` 打印出报文，再启动 `npm run dev`，
用打印的 URL 访问 `http://localhost:3000/api/wechat?...` 验证 GET 握手返回明文，
或用 curl POST 验证返回 `success`。

## 部署到 Vercel

1. 把项目推送到 GitHub，在 Vercel 导入（Framework 自动识别 Next.js）。
2. 在 **Settings → Environment Variables** 配置全部必填变量（参考 `.env.example`）。
3. 部署后获得域名，如 `https://xxx.vercel.app`。

回调路由：
- 回调 URL：`https://xxx.vercel.app/api/wechat`
- 健康检查：`https://xxx.vercel.app/api/health`

> `route.ts` 已声明 `maxDuration = 120`；Vercel Fluid Compute（Hobby 上限 300s）足以支撑分析任务。

## 企业微信后台配置

1. 管理后台 → **应用管理** → 创建自建应用。
2. 应用 → **接收消息**：
   - URL：`https://xxx.vercel.app/api/wechat`
   - Token：填 `WECHAT_TOKEN`
   - EncodingAESKey：点「随机生成」或自填，填入 `WECHAT_ENCODING_AES_KEY`
   - 消息加解密方式：**安全模式**
   - 点「保存」→ 企微会发 GET 握手请求验证（Vercel 日志能看到）。
3. 应用 → **开发者接口 → 企业微信机器人/网页授权**等按需启用；使用应用消息推送无需额外配置。
4. 应用 → 功能设置，把**接收消息**勾选的事件/消息类型确认即可。

## 使用方式

在企业微信里向该应用发送：

```
https://www.figma.com/design/abc123/页面?node-id=0%3A1
```

- 带 `node-id`：分析指定画板
- 不带 `node-id`：自动取文件首个 Canvas 下的首个 Frame

约 30~60 秒后收到 Markdown 分析报告（含高清切图下载链接）。

也可以直接在企业微信里**发送画板截图**（粘贴 Ctrl+V），系统会直连视觉模型进行秒级 UI 分析，完全绕过 Figma API 频控。

## 目录结构

```
app/api/wechat/route.ts   # 网关入口：GET 握手 / POST 回调 / waitUntil() 异步保活
app/api/health/route.ts   # 健康检查
lib/
  env.ts                  # 环境变量读取 + 校验
  wechat-crypto.ts        # SHA1 验签 + AES-256-CBC 加解密（标准 crypto）
  wechat-xml.ts           # XML/JSON 回调解析与归一化
  wechat-client.ts        # access_token + 应用消息(markdown)发送
  figma.ts                # Figma 链接解析 + REST 客户端
  ai.ts                   # 多模态设计分析（OpenAI 兼容）
  format.ts               # 企微 markdown 组装
  pipeline.ts             # 编排：figma → ai → 推送
scripts/
  make-callback.ts        # 生成自测报文
  parse-figma.test.ts     # 链接解析表驱动测试
```

## 安全说明

- 所有密钥仅从环境变量读取，不硬编码。
- 回调先验签后解密（防 padding oracle），验签用恒时比较。
- 解密严格校验尾部 corpid，防止错配 AESKey。
- 加解密/密钥不写入日志，日志只输出摘要与异常信息。
