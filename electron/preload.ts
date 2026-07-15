import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  ArchiveFolder,
  Conversation,
  Message,
  Project,
  PsdMeta,
  RecutProgress,
  RecutResult,
  VersionDiffResult,
  VersionSnapshot
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

  // 认证(auth.json)
  authGet: (provider: string): Promise<string> => ipcRenderer.invoke(IPC.authGet, provider),
  authSet: (provider: string, apiKey: string): Promise<void> =>
    ipcRenderer.invoke(IPC.authSet, provider, apiKey),

  // PSD
  psdRead: (psdPath: string): Promise<PsdMeta> => ipcRenderer.invoke(IPC.psdRead, psdPath),

  // 图层缓存(每对话 layers.json)
  layersPrepare: (conversationId: string): Promise<PsdMeta> =>
    ipcRenderer.invoke(IPC.layersPrepare, conversationId),
  layersRefresh: (conversationId: string): Promise<PsdMeta> =>
    ipcRenderer.invoke(IPC.layersRefresh, conversationId),
  layersGet: (conversationId: string): Promise<PsdMeta> =>
    ipcRenderer.invoke(IPC.layersGet, conversationId),

  // Photoshop
  psDetect: (): Promise<{ app: string; version?: string } | null> =>
    ipcRenderer.invoke(IPC.psDetect),
  psTest: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.psTest),
  psOpenDesign: (
    psdPath: string
  ): Promise<{ ok: boolean; message: string; docName?: string }> =>
    ipcRenderer.invoke(IPC.psOpenDesign, psdPath),
  psActivate: (): Promise<void> => ipcRenderer.invoke(IPC.psActivate),

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
    apiProvider?: string
    apiKey?: string
    apiModel?: string
  }): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.agentCheck, draft),
  agentLogs: (
    conversationId: string
  ): Promise<{ ts: number; level: string; message: string }[]> =>
    ipcRenderer.invoke(IPC.agentLogs, conversationId),
  agentLogsPath: (conversationId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.agentLogsPath, conversationId),
  onAgentStream: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, data: unknown): void => cb(data)
    ipcRenderer.on(IPC.agentStream, listener)
    return () => ipcRenderer.removeListener(IPC.agentStream, listener)
  },

  // 导出
  exportConfirm: (conversationId: string, names?: string[]): Promise<{ ok: boolean; dir: string; count: number }> =>
    ipcRenderer.invoke(IPC.exportConfirm, conversationId, names),
  previewList: (conversationId: string): Promise<
      { name: string; dataUrl: string; w?: number; h?: number; x?: number; y?: number; seq: number }[]
    > => ipcRenderer.invoke(IPC.previewList, conversationId),
  previewDelete: (conversationId: string, names: string[]): Promise<{ deleted: number }> =>
    ipcRenderer.invoke(IPC.previewDelete, conversationId, names),

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
  }> => ipcRenderer.invoke(IPC.checkUpdate),

  // 版本管理
  versionsCheck: (projectId: number): Promise<{ created: boolean; snapshot: VersionSnapshot }> =>
    ipcRenderer.invoke(IPC.versionsCheck, projectId),
  versionsList: (projectId: number): Promise<VersionSnapshot[]> =>
    ipcRenderer.invoke(IPC.versionsList, projectId),
  versionsDiff: (projectId: number, baseVersion: number): Promise<VersionDiffResult> =>
    ipcRenderer.invoke(IPC.versionsDiff, projectId, baseVersion),

  // 归档
  previewArchiveList: (conversationId: string): Promise<ArchiveFolder[]> =>
    ipcRenderer.invoke(IPC.previewArchiveList, conversationId),
  previewArchiveCreate: (conversationId: string): Promise<{ path: string }> =>
    ipcRenderer.invoke(IPC.previewArchiveCreate, conversationId),

  // 重切
  previewRecut: (conversationId: string): Promise<RecutResult> =>
    ipcRenderer.invoke(IPC.previewRecut, conversationId),
  onRecutProgress: (cb: (event: { conversationId: string; progress: RecutProgress }) => void): (() => void) => {
    const listener = (_e: unknown, data: { conversationId: string; progress: RecutProgress }): void => cb(data)
    ipcRenderer.on(IPC.recutStream, listener)
    return () => ipcRenderer.removeListener(IPC.recutStream, listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
