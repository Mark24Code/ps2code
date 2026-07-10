import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  setDatabaseForTest,
  importProject,
  listProjects,
  createConversation,
  listConversations,
  updateConversation,
  addMessage,
  listMessages
} from '../electron/services/db'

beforeEach(() => {
  // 每个用例用全新的内存库
  setDatabaseForTest(new Database(':memory:'))
})

describe('项目去重(SPEC:相同文件路径复用项目)', () => {
  it('相同 psd 路径重复导入只保留一条,返回既有记录', () => {
    const p1 = importProject('/a/b/签到.psd', '签到')
    const p2 = importProject('/a/b/签到.psd', '签到')
    expect(p2.id).toBe(p1.id)
    expect(listProjects()).toHaveLength(1)
  })

  it('不同路径产生不同项目', () => {
    importProject('/a/1.psd', '1')
    importProject('/a/2.psd', '2')
    expect(listProjects()).toHaveLength(2)
  })
})

describe('对话与默认导出选项(SPEC:默认二倍图/裁剪)', () => {
  it('新建对话默认 2x 开、1x 关、裁剪开', () => {
    const p = importProject('/a/x.psd', 'x')
    const c = createConversation(p.id, '/tmp/c1', '/a')
    expect(c.opt2x).toBe(true)
    expect(c.opt1x).toBe(false)
    expect(c.optTrim).toBe(true)
    expect(c.title).toBe('新对话')
  })

  it('一个项目下可建多条对话', () => {
    const p = importProject('/a/x.psd', 'x')
    createConversation(p.id, '/tmp/1', '/a')
    createConversation(p.id, '/tmp/2', '/a')
    expect(listConversations(p.id)).toHaveLength(2)
  })

  it('更新对话选项与标题', () => {
    const p = importProject('/a/x.psd', 'x')
    const c = createConversation(p.id, '/tmp/1', '/a')
    const updated = updateConversation(c.id, { title: '导出图标', opt1x: true })
    expect(updated.title).toBe('导出图标')
    expect(updated.opt1x).toBe(true)
    expect(updated.opt2x).toBe(true) // 未改动保持
  })
})

describe('消息', () => {
  it('按对话追加与读取消息,顺序稳定', () => {
    const p = importProject('/a/x.psd', 'x')
    const c = createConversation(p.id, '/tmp/1', '/a')
    addMessage({ conversationId: c.id, role: 'user', content: '你好' })
    addMessage({ conversationId: c.id, role: 'assistant', content: '在' })
    const msgs = listMessages(c.id)
    expect(msgs.map((m) => m.content)).toEqual(['你好', '在'])
  })
})

