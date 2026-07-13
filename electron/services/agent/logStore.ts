import { homedir } from 'os'
import { join } from 'path'
import { appendFileSync, existsSync, mkdirSync } from 'fs'

// 按对话累积 Agent 请求的详细日志(内存 + 落盘到 ~/.ps2code/sessions/<sid>/logs)。

export interface AgentLogEntry {
  ts: number
  level: 'info' | 'request' | 'response' | 'tool' | 'error' | 'context'
  message: string
}

const MAX_PER_CONV = 500
const store = new Map<string, AgentLogEntry[]>()

function sessionsRoot(): string {
  return join(homedir(), '.ps2code', 'sessions')
}

// 会话目录:直接用对话 uuid(与 sqlite 一致),稳定可恢复。
export function sessionDir(conversationId: string): string {
  const dir = join(sessionsRoot(), conversationId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function logFile(conversationId: string): string {
  const logsDir = join(sessionDir(conversationId), 'logs')
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true })
  return join(logsDir, 'agent.log')
}

export function logPath(conversationId: string): string {
  const logsDir = join(sessionDir(conversationId), 'logs')
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true })
  return logsDir
}

export function addLog(
  conversationId: string,
  level: AgentLogEntry['level'],
  message: string
): void {
  const entry: AgentLogEntry = { ts: Date.now(), level, message }
  const list = store.get(conversationId) ?? []
  list.push(entry)
  if (list.length > MAX_PER_CONV) list.splice(0, list.length - MAX_PER_CONV)
  store.set(conversationId, list)
  // 落盘(每行一条 JSON,便于追加与恢复)
  try {
    appendFileSync(logFile(conversationId), JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    /* 落盘失败不阻断 */
  }
}

export function getLogs(conversationId: string): AgentLogEntry[] {
  return store.get(conversationId) ?? []
}

export function clearLogs(conversationId: string): void {
  store.delete(conversationId)
}
