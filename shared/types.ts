// 主进程与渲染进程共享的类型定义

export interface PsdLayerNode {
  id: string // 路径式稳定 id,如 "0/2/1"
  psId?: number // PSD 原生图层 id(lyid);用于在 Photoshop 中精确定位。可能缺失(旧 PSD/未写入)
  path: string // 图层名链路径,如 "根组/x默认/1"(用于展示与确认)
  name: string
  kind: 'group' | 'layer'
  hidden: boolean
  bounds: { left: number; top: number; right: number; bottom: number }
  width: number
  height: number
  opacity?: number   // 0-255;缺失 ≈ 255(不透明)
  blendMode?: string // 如 'normal'、'multiply'
  text?: string      // 文本图层内容
  fill?: string      // 填充色 hex 值(如 '#4f46e5')
  children?: PsdLayerNode[]
}

// 版本快照(metadata + 图层树)
export interface VersionSnapshot {
  id: number
  projectId: number
  version: number
  label: string      // "v1"、"v2"…
  mtime: string      // PSD 文件修改时间字符串
  size: string       // 文件大小字符串("2.4 MB")
  layerHash: string  // 图层树确定性 hash,用于判断内容是否真正变化
  createdAt: string  // 快照创建时间
  changeMessage?: string // 变更概要(<30 字),创建快照时由 diff 生成
}

// version_snapshots 表行(含 layerTree JSON)
export interface VersionSnapshotRow extends VersionSnapshot {
  layerTree: string  // PsdLayerNode[] 的 JSON 序列化
}

// 两个版本间的 diff 结果
export interface VersionDiffResult {
  baseVersion: number
  targetVersion: number
  lines: VersionDiffLine[]
  summary: { add: number; del: number; mod: number }
  /** 结构化图层对比,由 main process 直接从图层树计算,比解析 lines 文本更可靠 */
  layerSummary?: LayerSummary
}

export interface VersionDiffLine {
  left: string | null   // base 侧文本行;null = 新增行无对应
  right: string | null  // target 侧文本行;null = 删除行无对应
  type: 'eq' | 'chg'    // eq=无变化,chg=删除或新增
}

export interface LayerSummaryItem {
  name: string
  depth: number
  changes: string[]
}

export interface LayerSummary {
  added: LayerSummaryItem[]
  deleted: LayerSummaryItem[]
  modified: LayerSummaryItem[]
}

export interface PsdMeta {
  width: number
  height: number
  layerCount: number
  groupCount: number
  tree: PsdLayerNode[]
}

export interface Project {
  id: number
  name: string
  psdPath: string
  createdAt: string
  updatedAt: string
}

export interface Conversation {
  id: string // uuid(对话即 session)
  projectId: number
  title: string
  tmpDir: string
  exportDir: string
  optTrim: boolean
  opt1x: boolean
  opt2x: boolean
  optCompress: boolean // 导出后无损压缩 PNG
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'confirm'

export interface Message {
  id: number
  conversationId: string
  role: MessageRole
  content: string
  createdAt: string
}

export interface AppSettings {
  psPath: string
  apiProvider: string // pi-agent provider,如 'deepseek'
  apiKey: string
  apiModel: string
  defaultExportDir: string
}

// 导出布局清单:描述每张导出图片的原始来源与位置/尺寸/层级,便于据此还原布局。
export interface LayoutItem {
  file: string // 最终落地文件名(含 @2x)
  psId?: number // PSD 原生图层 id
  path?: string // 图层名链路径,如 根组/x默认/1
  x: number // 原始左上角 x(画布坐标)
  y: number // 原始左上角 y
  w: number // 宽(该文件像素尺寸)
  h: number // 高
  zIndex: number // 相对层级:越靠上越大(顶层在上)
  scale: number // 倍率:@2x 为 2,其余 1
}

export interface LayoutManifest {
  canvas: { width: number; height: number }
  items: LayoutItem[]
}

// Agent 流式事件
export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; text: string }
  | { type: 'confirm'; id: string; prompt: string; payload: unknown }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
