/**
 * 编排流水线：Figma 链接 → 解析 → 元数据/切图/Token 并行获取 → LLM 分析 → 企微推送。
 * 每步独立 try/catch，永不向外抛异常（after() 后台任务要求）。
 */
import {
  parseFigmaUrl,
  resolveTargetNodeId,
  getNodeMetadata,
  exportImage,
  getDesignTokens,
} from "./figma";
import { analyzeDesign } from "./ai";
import { sendMarkdown } from "./wechat-client";
import {
  formatAnalysisMarkdown,
  formatErrorMarkdown,
  formatNoLinkMarkdown,
  formatProcessingMarkdown,
} from "./format";
import type { NormalizedWechatMessage } from "../types/wechat";

const logger = console;

/** 处理一条企微文本消息（含或不含 Figma 链接）。 */
export async function runPipeline(msg: NormalizedWechatMessage): Promise<void> {
  try {
    const link = parseFigmaUrl(msg.content);
    if (!link) {
      logger.info(`[pipeline] 消息无 Figma 链接: ${msg.fromUserName}`);
      await safeSend(msg.fromUserName, formatNoLinkMarkdown());
      return;
    }
    logger.info(`[pipeline] 收到 Figma: file=${link.fileKey} node=${link.nodeId ?? "(auto)"}`);

    // 发送"处理中"提示，缓解 30-60s 等待
    await safeSend(msg.fromUserName, formatProcessingMarkdown());

    const target = await resolveTargetNodeId(link.fileKey, link.nodeId);

    // 并行获取：节点元数据、高清切图、Design Tokens（Tokens 失败不阻塞主流程）
    const [metadata, exportRes, tokens] = await Promise.all([
      getNodeMetadata(target.fileKey, target.nodeId),
      exportImage(target.fileKey, target.nodeId),
      getDesignTokens(target.fileKey).catch(() => undefined),
    ]);

    logger.info(`[pipeline] Figma 数据就绪，开始 LLM 分析: ${metadata.name}`);
    const analysis = await analyzeDesign(exportRes.imageUrl, metadata, tokens);

    const markdown = formatAnalysisMarkdown(analysis, metadata, [exportRes], tokens);
    await safeSend(msg.fromUserName, markdown);
    logger.info(`[pipeline] 分析结果已推送: ${msg.fromUserName}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`[pipeline] 失败: ${message}`);
    try {
      await sendMarkdown(msg.fromUserName, formatErrorMarkdown(message));
    } catch (sendErr) {
      logger.error(`[pipeline] 推送错误消息也失败: ${sendErr}`);
    }
  }
}

/** 安全发送：失败仅记录日志，不抛出。 */
async function safeSend(touser: string, content: string): Promise<void> {
  try {
    await sendMarkdown(touser, content);
  } catch (e) {
    logger.error(`[pipeline] 发送失败: ${(e as Error).message}`);
  }
}
