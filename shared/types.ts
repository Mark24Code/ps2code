// 主进程与渲染进程共享的类型定义

export interface PsdLayerNode {
  id: string // 路径式稳定 id,如 "0/2/1"
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

// Agent 流式事件
export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; text: string }
  | { type: 'confirm'; id: string; prompt: string; payload: unknown }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
