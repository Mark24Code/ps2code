import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { setDatabaseForTest, importProject, createConversation } from '../electron/services/db'
import { setBridgeForTest, type PhotoshopBridge } from '../electron/services/photoshop'
import { createToolHandlers } from '../electron/services/agent/agentTools'
import type { AgentStreamEvent } from '../shared/types'

// 验证「Agent 对话可调用至少一个脚本」:
// 通过 createToolHandlers(runAgent 也用它注册工具)调用 export/rename,
// 用 FakeBridge 确认脚本被真正执行(拿到脚本内容)。
class FakeBridge implements PhotoshopBridge {
  lastScript = ''
  reply = JSON.stringify({ ok: true, data: {}, log: [], error: '' })
  async detect(): Promise<null> {
    return null
  }
  async runJsx(src: string): Promise<string> {
    this.lastScript = src
    return this.reply
  }
  async runJsxFile(): Promise<string> {
    return this.reply
  }
  async activate(): Promise<void> {}
}

let fake: FakeBridge

beforeEach(() => {
  setDatabaseForTest(new Database(':memory:'))
  fake = new FakeBridge()
  setBridgeForTest(fake)
})

describe('Agent 对话可调用脚本', () => {
  it('rename_groups 工具调用触达脚本并回传 tool_result 事件', async () => {
    const project = importProject('/tmp/a.psd', 'a')
    const conv = createConversation(project.id, '/tmp/tmp', '/tmp/out')

    fake.reply = JSON.stringify({
      ok: true,
      data: { rules: [{ from: '组84', to: '组184', count: 1 }] },
      log: ['OK 组84 -> 组184'],
      error: ''
    })

    const events: AgentStreamEvent[] = []
    const handlers = createToolHandlers({
      targetPath: project.psdPath,
      conversationId: conv.id,
      emit: (e) => events.push(e)
    })

    const res = await handlers.renameGroups({ rules: [{ from: '组84', to: '组184' }] })

    // 脚本被执行(拿到组装后的脚本内容)
    expect(fake.lastScript).toContain('组84')
    expect(fake.lastScript).toContain('renameIn')
    // 工具返回成功,并发出 tool_result 事件供 UI 展示
    expect(res.isError).toBeFalsy()
    expect(events.some((e) => e.type === 'tool_result' && e.name === 'rename_groups')).toBe(true)
  })

  it('export_groups 工具按对话设置组装导出参数并调用脚本', async () => {
    const project = importProject('/tmp/b.psd', 'b')
    const conv = createConversation(project.id, '/tmp/tmp2', '/tmp/out2')

    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/tmp/tmp2/组84@2x.png'], matched: 1, ok: 1, err: 0, outputDir: '/tmp/tmp2' },
      log: [],
      error: ''
    })

    const events: AgentStreamEvent[] = []
    const handlers = createToolHandlers({
      targetPath: project.psdPath,
      conversationId: conv.id,
      emit: (e) => events.push(e)
    })

    const res = await handlers.exportGroups({ names: ['组84'] })
    expect(res.isError).toBeFalsy()
    expect(fake.lastScript).toContain('组84')
    expect(fake.lastScript).toContain('convertToSmartObject')
    expect(events.some((e) => e.type === 'tool_result' && e.name === 'export_groups')).toBe(true)
  })

  it('删除类操作会请求确认;拒绝则不执行脚本', async () => {
    const project = importProject('/tmp/c.psd', 'c')
    const conv = createConversation(project.id, '/tmp/tmp3', '/tmp/out3')

    const confirm = vi.fn(async () => false) // 用户拒绝
    const handlers = createToolHandlers({
      targetPath: project.psdPath,
      conversationId: conv.id,
      emit: () => {},
      requestConfirm: confirm
    })

    fake.lastScript = ''
    const res = await handlers.mutateLayers({ ops: [{ action: 'delete', name: '组9' }] })
    expect(confirm).toHaveBeenCalledOnce()
    expect(fake.lastScript).toBe('') // 拒绝后未执行任何脚本
    expect(res.content[0].text).toContain('取消')
  })

  it('export_groups 工具回传详细日志供 Agent 排查', async () => {
    const project = importProject('/tmp/e.psd', 'e')
    const conv = createConversation(project.id, '/tmp/logtest', '/tmp/out')

    fake.reply = JSON.stringify({
      ok: false,
      data: { files: [], matched: 1, ok: 0, err: 1, outputDir: '/tmp/logtest' },
      log: [
        '--- 处理: 组84',
        '已复制图层组',
        'convertToSmartObject 失败: General Photoshop error → 尝试回退方案',
        '  [回退] mergeVisibleLayers 失败: some error (line 200)',
        '✕ 失败 [组84]: some error'
      ],
      error: '导出失败: some error'
    })

    const handlers = createToolHandlers({
      targetPath: project.psdPath,
      conversationId: conv.id,
      emit: () => {}
    })

    const res = await handlers.exportGroups({ names: ['组84'] })
    // 全失败 → isError = true
    expect(res.isError).toBe(true)
    // 日志应被注入到返回数据中
    const data = JSON.parse(res.content[0].text)
    expect(data._log).toBeDefined()
    expect(Array.isArray(data._log)).toBe(true)
    expect(data._log.length).toBeGreaterThan(0)
    // 日志含错误详情
    expect(data._log.some((l: string) => l.includes('失败') || l.includes('Error'))).toBe(true)
  })

  it('export_groups 部分成功部分失败:综合工具返回', async () => {
    const project = importProject('/tmp/f.psd', 'f')
    const conv = createConversation(project.id, '/tmp/partial', '/tmp/out')

    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/tmp/partial/ok组.png'], matched: 3, ok: 1, err: 2, outputDir: '/tmp/partial' },
      log: [
        '--- 处理: ok组',
        '已复制图层组',
        '✓ 完成: ok组',
        '✕ 失败 [bad组1]: error1',
        '✕ 失败 [bad组2]: error2'
      ],
      error: ''
    })

    const handlers = createToolHandlers({
      targetPath: project.psdPath,
      conversationId: conv.id,
      emit: () => {}
    })

    const res = await handlers.exportGroups({ names: ['ok组', 'bad组1', 'bad组2'] })
    // 部分失败 → 仍有 error 标记
    expect(res.isError).toBe(true)
    const data = JSON.parse(res.content[0].text)
    expect(data.ok).toBe(1)
    expect(data.err).toBe(2)
    expect(data.files.length).toBe(1)
  })
})
