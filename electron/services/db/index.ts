import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type {
  AppSettings,
  Conversation,
  Message,
  Project
} from '../../../shared/types'
import { createSchema } from './schema'

let db: Database.Database

const DEFAULT_SETTINGS: AppSettings = {
  psPath: '',
  apiBaseUrl: '',
  apiKey: '',
  apiModel: 'claude-sonnet-4-5',
  defaultExportDir: ''
}

export function initDatabase(): void {
  const file = join(app.getPath('userData'), 'ps2code.db')
  db = new Database(file)
  createSchema(db)
}

// 测试用:注入自定义数据库实例(如内存库)
export function setDatabaseForTest(instance: Database.Database): void {
  db = instance
  createSchema(db)
}

// ---------- 行映射 ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    psdPath: r.psd_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function mapConversation(r: any): Conversation {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    tmpDir: r.tmp_dir,
    exportDir: r.export_dir,
    optTrim: !!r.opt_trim,
    opt1x: !!r.opt_1x,
    opt2x: !!r.opt_2x,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function mapMessage(r: any): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- 项目 ----------
export function importProject(psdPath: string, name: string): Project {
  const existing = db.prepare('SELECT * FROM projects WHERE psd_path = ?').get(psdPath)
  if (existing) return mapProject(existing)
  const info = db
    .prepare('INSERT INTO projects (name, psd_path) VALUES (?, ?)')
    .run(name, psdPath)
  return mapProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid))
}

export function listProjects(): Project[] {
  return db
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all()
    .map(mapProject)
}

export function getProject(id: number): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return r ? mapProject(r) : null
}

export function deleteProject(id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// ---------- 对话 ----------
export function createConversation(
  projectId: number,
  tmpDir: string,
  exportDir: string
): Conversation {
  const info = db
    .prepare(
      'INSERT INTO conversations (project_id, tmp_dir, export_dir) VALUES (?, ?, ?)'
    )
    .run(projectId, tmpDir, exportDir)
  return mapConversation(
    db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid)
  )
}

export function listConversations(projectId: number): Conversation[] {
  return db
    .prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId)
    .map(mapConversation)
}

export function getConversation(id: number): Conversation | null {
  const r = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  return r ? mapConversation(r) : null
}

export function updateConversation(id: number, patch: Partial<Conversation>): Conversation {
  const cur = getConversation(id)
  if (!cur) throw new Error('conversation not found')
  const next = { ...cur, ...patch }
  db.prepare(
    `UPDATE conversations SET title=?, export_dir=?, opt_trim=?, opt_1x=?, opt_2x=?,
     updated_at=datetime('now') WHERE id=?`
  ).run(
    next.title,
    next.exportDir,
    next.optTrim ? 1 : 0,
    next.opt1x ? 1 : 0,
    next.opt2x ? 1 : 0,
    id
  )
  return getConversation(id) as Conversation
}

export function deleteConversation(id: number): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// ---------- 消息 ----------
export function addMessage(m: Omit<Message, 'id' | 'createdAt'>): Message {
  const info = db
    .prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(m.conversationId, m.role, m.content)
  return mapMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid))
}

export function listMessages(conversationId: number): Message[] {
  return db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversationId)
    .map(mapMessage)
}

// ---------- 设置 ----------
export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...map } as AppSettings
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  )
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, v)
  })
  tx(Object.entries(patch).map(([k, v]) => [k, String(v ?? '')]))
  return getSettings()
}
