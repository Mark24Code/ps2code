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
  projectUpdate: 'db:projects:update',
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

  // 认证(auth.json,与 config.json 分离)
  authGet: 'auth:get',       // 读取某 provider 的 apiKey
  authSet: 'auth:set',       // 写入某 provider 的 apiKey

  // PSD
  psdRead: 'psd:read',

  // 图层缓存(每对话 layers.json)
  layersPrepare: 'layers:prepare', // 进入对话:现读并落盘缓存
  layersRefresh: 'layers:refresh', // 强制重建缓存(刷新按钮/回到 app)
  layersGet: 'layers:get', // 读缓存(渲染层展示)

  // Photoshop
  psDetect: 'ps:detect',
  psTest: 'ps:test',
  psOpenDesign: 'ps:openDesign',
  psActivate: 'ps:activate',

  // Agent
  agentSend: 'agent:send',
  agentConfirm: 'agent:confirm',
  agentCancel: 'agent:cancel',
  agentStream: 'agent:stream', // 主→渲染 事件
  agentCheck: 'agent:check',
  agentLogs: 'agent:logs',
  agentLogsPath: 'agent:logsPath',

  // 导出
  exportRun: 'export:run',
  exportConfirm: 'export:confirm',
  previewList: 'export:previewList',
  previewDelete: 'export:previewDelete',

  // 文件选择
  pickPsd: 'dialog:pickPsd',
  pickDir: 'dialog:pickDir',

  // 更新
  checkUpdate: 'update:check',

  // 读取本地文件为 data URL(用于 markdown 图片渲染)
  readFileAsDataUrl: 'app:readFileAsDataUrl',

  // 窗口重新聚焦(用户可能在 PS 编辑后切回,用于自动刷新)
  windowFocused: 'app:windowFocused',

  // 版本管理
  versionsCheck: 'versions:check',
  versionsList: 'versions:list',
  versionsDiff: 'versions:diff',

  // 归档
  previewArchiveList: 'archive:list',
  previewArchiveCreate: 'archive:create',

  // 重切
  previewRecut: 'recut:run',
  recutStream: 'recut:stream',

  // Analytics
  analyticsEvent: 'analytics:event',
  analyticsStatus: 'analytics:status',
  analyticsSetSecret: 'analytics:setSecret',
  analyticsDisable: 'analytics:disable',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
