/**
 * 编排流水线：Figma 链接 → 解析 → 元数据/切图/Token 并行获取 → LLM 分析 → 企微推送。
 *
 * 错误处理约定：
 *  - 最终「分析结果」推送必须成功；若企微返回非 0 errcode（如 60020），
 *    立即抛错中断（绝不打印"已推送"），由外层 catch 向用户反馈错误。
 *  - 辅助提示（处理中 / 无链接）失败仅记录日志，不阻塞主流程。
 *  - runPipeline 返回 boolean：true=成功，false=失败，供调用方（after 回调）记录状态。
 */
import { parseFigmaUrl, resolveTargetNodeId, exportImage } from "./figma";
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

/** 处理一条企微文本消息（含或不含 Figma 链接）。返回 true=成功，false=失败。 */
export async function runPipeline(msg: NormalizedWechatMessage): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const link = parseFigmaUrl(msg.content);
    if (!link) {
      logger.info(`[pipeline] 消息无 Figma 链接: ${msg.fromUserName}`);
      await safeSend(msg.fromUserName, formatNoLinkMarkdown());
      return true;
    }
    logger.info(`[pipeline] 收到 Figma: file=${link.fileKey} node=${link.nodeId ?? "(auto)"}`);

    // 发送"处理中"提示（辅助，失败不阻塞）
    await safeSend(msg.fromUserName, formatProcessingMarkdown());

    const target = await resolveTargetNodeId(link.fileKey, link.nodeId);

    // 极致精简：仅一次切图请求，视觉模型直接识别布局/层级/色值，
    // 不再拉取节点元数据与 Design Tokens，最大限度压低 API 消耗
    const exportRes = await exportImage(target.fileKey, target.nodeId);

    logger.info(`[pipeline] Figma 切图就绪，开始 LLM 分析: ${target.nodeId}`);
    const analysis = await analyzeDesign(exportRes.imageUrl);

    const figmaUrl = `https://www.figma.com/file/${target.fileKey}?node-id=${encodeURIComponent(target.nodeId)}`;
    const markdown = formatAnalysisMarkdown(analysis, {
      exports: [exportRes],
      figmaUrl,
      durationMs: Date.now() - startedAt,
    });

    // 最终结果：发送失败必须抛错，由外层 catch 向用户反馈；成功才打印"已推送"
    try {
      await sendMarkdown(msg.fromUserName, markdown);
    } catch (e) {
      logger.error(`[pipeline] 分析结果推送失败: ${(e as Error).message}`);
      throw e;
    }
    logger.info(`[pipeline] 分析结果已推送: ${msg.fromUserName}`);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`[pipeline] 失败: ${message}`);
    // 向外层反馈错误状态：尽力把错误原因推送给用户；再失败则仅记录
    try {
      await sendMarkdown(msg.fromUserName, formatErrorMarkdown(message));
    } catch (sendErr) {
      logger.error(`[pipeline] 推送错误消息也失败: ${sendErr}`);
    }
    return false;
  }
}

/** 辅助消息安全发送：失败仅记录日志，不抛出（用于"处理中/无链接"等非关键提示）。 */
async function safeSend(touser: string, content: string): Promise<void> {
  try {
    await sendMarkdown(touser, content);
  } catch (e) {
    logger.error(`[pipeline] 辅助提示发送失败: ${(e as Error).message}`);
  }
}
