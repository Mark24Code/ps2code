// Google Analytics 事件名称与类型定义
// 桌面应用走 GA4 Measurement Protocol API(非 gtag.js 网页版)

export const GA_MEASUREMENT_ID = 'G-C3VVFVX2HT'

export const AnalyticsEvent = {
  APP_LAUNCH: 'app_launch',
  APP_CLOSE: 'app_close',

  PROJECT_IMPORT: 'project_import',
  PROJECT_DELETE: 'project_delete',

  CONVERSATION_CREATE: 'conversation_create',
  CONVERSATION_DELETE: 'conversation_delete',
  MESSAGE_SEND: 'message_send',

  EXPORT_CONFIRM: 'export_confirm',
  EXPORT_RECUT: 'export_recut',

  AGENT_ACTION: 'agent_action',
  PS_CONNECTED: 'ps_connected',
  PS_CONNECT_FAIL: 'ps_connect_fail',

  SETTINGS_CHANGE: 'settings_change',
  SETTINGS_API_CHANGE: 'settings_api_change',
} as const

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent]
