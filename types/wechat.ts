/**
 * 企业微信消息与设计分析的共享类型定义。
 */

/** 归一化后的企微消息（XML/JSON 回调统一映射到该结构）。 */
export interface NormalizedWechatMessage {
  msgId: string;
  toUserName: string;
  fromUserName: string;
  msgType: string; // text / event / image / ...
  content: string; // 文本内容（text 消息）
  createTime?: string;
  event?: string; // 事件类型（msgType === "event" 时）
  raw: string; // 明文原文（供调试）
}

/** Figma 链接解析结果。 */
export interface FigmaLink {
  fileKey: string;
  nodeId?: string;
}

/** Figma 节点元数据（精简，仅分析需要）。 */
export interface FigmaNodeInfo {
  nodeId: string;
  name: string;
  type?: string;
  width?: number;
  height?: number;
  fillColors: string[];
  fonts: string[];
  childCount: number;
}

/** Design Tokens（从 Figma Variables 提取）。 */
export interface FigmaDesignTokens {
  colors: { name: string; value: string }[];
  typography: { name: string; value: string }[];
}

/** Figma 切图导出结果。 */
export interface FigmaExport {
  nodeId: string;
  imageUrl: string;
  format: "png" | "svg";
}

/** 大模型设计分析结果。 */
export interface AnalysisResult {
  interfaceLevels: string;
  primaryColors: string[];
  usabilityScore: number; // 0-10
  suggestions: string[];
  tailwindSnippet: string;
  reactSnippet: string;
}

/** 企微应用消息发送结果。 */
export interface WechatSendResult {
  errcode: number;
  errmsg: string;
  invaliduser?: string;
  msgid?: string;
}
