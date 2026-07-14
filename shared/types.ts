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
  children?: PsdLayerNode[]
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
