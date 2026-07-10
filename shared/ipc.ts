// IPC 通道名常量,主进程与 preload 共用

export const IPC = {
  // 通用
  ping: 'app:ping',
  appVersion: 'app:version',
  openPath: 'app:openPath',
  openExternal: 'app:openExternal',

  // 项目
  projectImport: 'db:projects:import', // 拖入/选择 psd → 去重建项目
  projectList: 'db:projects:list',
  projectGet: 'db:projects:get',
  projectDelete: 'db:projects:delete',

  // 对话
  convList: 'db:conversations:list',
  convCreate: 'db:conversations:create',
  convGet: 'db:conversations:get',
  convUpdate: 'db:conversations:update',
  convDelete: 'db:conversations:delete',

  // 消息
  msgList: 'db:messages:list',
  msgAdd: 'db:messages:add',

  // 设置
  settingsGet: 'db:settings:get',
  settingsSet: 'db:settings:set',

  // PSD
  psdRead: 'psd:read',

  // Photoshop
  psDetect: 'ps:detect',
  psTest: 'ps:test',
  psOpenDesign: 'ps:openDesign',

  // Agent
  agentSend: 'agent:send',
  agentConfirm: 'agent:confirm',
  agentCancel: 'agent:cancel',
  agentStream: 'agent:stream', // 主→渲染 事件
  agentCheck: 'agent:check',
  agentLogs: 'agent:logs',

  // 导出
  exportRun: 'export:run',
  exportConfirm: 'export:confirm',
  previewList: 'export:previewList',

  // 文件选择
  pickPsd: 'dialog:pickPsd',
  pickDir: 'dialog:pickDir',

  // 更新
  checkUpdate: 'update:check',

  // 窗口重新聚焦(用户可能在 PS 编辑后切回,用于自动刷新)
  windowFocused: 'app:windowFocused'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
