import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  Conversation,
  Message,
  Project,
  PsdMeta
} from '../shared/types'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke(IPC.openPath, p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  // 拖拽的 File 只能拿到 name;用 webUtils 取绝对路径
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // 项目
  projectImport: (psdPath: string): Promise<Project> =>
    ipcRenderer.invoke(IPC.projectImport, psdPath),
  projectList: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projectList),
  projectGet: (id: number): Promise<Project | null> => ipcRenderer.invoke(IPC.projectGet, id),
  projectUpdate: (id: number, name: string): Promise<Project> =>
    ipcRenderer.invoke(IPC.projectUpdate, id, name),
  projectDelete: (id: number): Promise<void> => ipcRenderer.invoke(IPC.projectDelete, id),

  // 对话
  convList: (projectId: number): Promise<Conversation[]> =>
    ipcRenderer.invoke(IPC.convList, projectId),
  convCreate: (projectId: number): Promise<Conversation> =>
    ipcRenderer.invoke(IPC.convCreate, projectId),
  convGet: (id: string): Promise<Conversation | null> => ipcRenderer.invoke(IPC.convGet, id),
  convUpdate: (id: string, patch: Partial<Conversation>): Promise<Conversation> =>
    ipcRenderer.invoke(IPC.convUpdate, id, patch),
  convDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.convDelete, id),

  // 消息
  msgList: (conversationId: string): Promise<Message[]> =>
    ipcRenderer.invoke(IPC.msgList, conversationId),
  msgAdd: (m: Omit<Message, 'id' | 'createdAt'>): Promise<Message> =>
    ipcRenderer.invoke(IPC.msgAdd, m),

  // 设置
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  // PSD
  psdRead: (psdPath: string): Promise<PsdMeta> => ipcRenderer.invoke(IPC.psdRead, psdPath),

  // Photoshop
  psDetect: (): Promise<{ app: string; version?: string } | null> =>
    ipcRenderer.invoke(IPC.psDetect),
  psTest: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.psTest),
  psOpenDesign: (
    psdPath: string
  ): Promise<{ ok: boolean; message: string; docName?: string }> =>
    ipcRenderer.invoke(IPC.psOpenDesign, psdPath),

  // Agent
  agentSend: (payload: {
    conversationId: string
    text: string
  }): Promise<void> => ipcRenderer.invoke(IPC.agentSend, payload),
  agentConfirm: (id: string, approved: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.agentConfirm, id, approved),
  agentCancel: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.agentCancel, conversationId),
  agentCheck: (draft?: {
    apiBaseUrl?: string
    apiKey?: string
    apiModel?: string
  }): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.agentCheck, draft),
  agentLogs: (
    conversationId: string
  ): Promise<{ ts: number; level: string; message: string }[]> =>
    ipcRenderer.invoke(IPC.agentLogs, conversationId),
  onAgentStream: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, data: unknown): void => cb(data)
    ipcRenderer.on(IPC.agentStream, listener)
    return () => ipcRenderer.removeListener(IPC.agentStream, listener)
  },

  // 导出
  exportConfirm: (conversationId: string, names?: string[]): Promise<{ ok: boolean; dir: string; count: number }> =>
    ipcRenderer.invoke(IPC.exportConfirm, conversationId, names),
  previewList: (conversationId: string): Promise<
      { name: string; dataUrl: string; w?: number; h?: number; x?: number; y?: number }[]
    > => ipcRenderer.invoke(IPC.previewList, conversationId),

  // 文件选择
  pickPsd: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickPsd),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDir),

  // 读取本地文件为 data URL
  readFileAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.readFileAsDataUrl, filePath),

  // 窗口重新聚焦事件(用户可能在 PS 编辑后切回)
  onWindowFocused: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.windowFocused, listener)
    return () => ipcRenderer.removeListener(IPC.windowFocused, listener)
  },

  // 更新
  checkUpdate: (): Promise<{
    hasUpdate: boolean
    current: string
    latest?: string
    url?: string
    error?: string
  }> => ipcRenderer.invoke(IPC.checkUpdate)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
