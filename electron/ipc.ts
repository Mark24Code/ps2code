import { app, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, join } from 'path'
import { copyFile, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { IPC } from '../shared/ipc'
import type { AgentStreamEvent, AppSettings, Conversation } from '../shared/types'
import * as db from './services/db'
import { readPsdMeta } from './services/psd'
import { getBridge } from './services/photoshop'
import { testConnection } from './services/photoshop/operations'
import { cancelAgent, resolveConfirm, runAgent } from './services/agent'
import { checkUpdate } from './services/updater'
import { getMainWindow } from './main'

function convTmpDir(conversationId: number): string {
  return join(app.getPath('temp'), 'ps2code', String(conversationId))
}

export function registerIpc(): void {
  // ---------- 通用 ----------
  ipcMain.handle(IPC.ping, () => 'pong')
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))

  // ---------- 项目 ----------
  ipcMain.handle(IPC.projectImport, (_e, psdPath: string) => {
    const name = basename(psdPath).replace(/\.psd$/i, '')
    return db.importProject(psdPath, name)
  })
  ipcMain.handle(IPC.projectList, () => db.listProjects())
  ipcMain.handle(IPC.projectGet, (_e, id: number) => db.getProject(id))
  ipcMain.handle(IPC.projectDelete, (_e, id: number) => db.deleteProject(id))

  // ---------- 对话 ----------
  ipcMain.handle(IPC.convList, (_e, projectId: number) => db.listConversations(projectId))
  ipcMain.handle(IPC.convCreate, async (_e, projectId: number) => {
    const project = db.getProject(projectId)
    const defaultExport = project ? dirname(project.psdPath) : db.getSettings().defaultExportDir
    // 先建记录拿到 id,再回填 tmpDir
    const conv = db.createConversation(projectId, '', defaultExport)
    const tmp = convTmpDir(conv.id)
    await mkdir(tmp, { recursive: true })
    return db.updateConversation(conv.id, { tmpDir: tmp } as Partial<Conversation>)
  })
  ipcMain.handle(IPC.convGet, (_e, id: number) => db.getConversation(id))
  ipcMain.handle(IPC.convUpdate, (_e, id: number, patch: Partial<Conversation>) =>
    db.updateConversation(id, patch)
  )
  ipcMain.handle(IPC.convDelete, (_e, id: number) => db.deleteConversation(id))

  // ---------- 消息 ----------
  ipcMain.handle(IPC.msgList, (_e, conversationId: number) => db.listMessages(conversationId))
  ipcMain.handle(IPC.msgAdd, (_e, m) => db.addMessage(m))

  // ---------- 设置 ----------
  ipcMain.handle(IPC.settingsGet, () => db.getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => db.setSettings(patch))

  // ---------- PSD ----------
  ipcMain.handle(IPC.psdRead, (_e, psdPath: string) => readPsdMeta(psdPath))

  // ---------- Photoshop ----------
  ipcMain.handle(IPC.psDetect, () => getBridge().detect())
  ipcMain.handle(IPC.psTest, () => testConnection())

  // ---------- Agent ----------
  ipcMain.handle(
    IPC.agentSend,
    async (_e, payload: { conversationId: number; text: string }) => {
      db.addMessage({ conversationId: payload.conversationId, role: 'user', content: payload.text })
      // 首条用户消息 → 自动生成对话标题
      const conv = db.getConversation(payload.conversationId)
      if (conv && conv.title === '新对话') {
        const title = payload.text.replace(/\s+/g, ' ').trim().slice(0, 20) || '新对话'
        db.updateConversation(payload.conversationId, { title })
      }
      const emit = (event: AgentStreamEvent): void => {
        getMainWindow()?.webContents.send(IPC.agentStream, {
          conversationId: payload.conversationId,
          event
        })
        // 持久化关键消息(result 仅作流结束信号,其文本已由 text 事件落库,避免重复)
        if (event.type === 'text') {
          if (event.text.trim())
            db.addMessage({
              conversationId: payload.conversationId,
              role: 'assistant',
              content: event.text
            })
        } else if (event.type === 'tool_use') {
          db.addMessage({
            conversationId: payload.conversationId,
            role: 'tool',
            content: `→ 调用工具 ${event.name}`
          })
        } else if (event.type === 'tool_result') {
          db.addMessage({
            conversationId: payload.conversationId,
            role: 'tool',
            content: event.text
          })
        }
      }
      await runAgent(payload.conversationId, payload.text, emit)
    }
  )
  ipcMain.handle(IPC.agentConfirm, (_e, id: string, approved: boolean) =>
    resolveConfirm(id, approved)
  )
  ipcMain.handle(IPC.agentCancel, (_e, conversationId: number) => cancelAgent(conversationId))

  // ---------- 导出确认: tmp → exportDir ----------
  ipcMain.handle(IPC.exportConfirm, async (_e, conversationId: number) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const dest = conv.exportDir
    await mkdir(dest, { recursive: true })
    const files = existsSync(conv.tmpDir)
      ? (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))
      : []
    for (const f of files) {
      let target = join(dest, f)
      // 去重:同名追加序号
      let i = 1
      const dot = f.lastIndexOf('.')
      const stem = dot >= 0 ? f.slice(0, dot) : f
      const ext = dot >= 0 ? f.slice(dot) : ''
      while (existsSync(target)) {
        target = join(dest, `${stem}(${i})${ext}`)
        i++
      }
      await copyFile(join(conv.tmpDir, f), target)
    }
    return { ok: true, dir: dest, count: files.length }
  })

  // ---------- 预览: 列出对话 tmp 下的 PNG,返回 dataURL ----------
  ipcMain.handle(IPC.previewList, async (_e, conversationId: number) => {
    const conv = db.getConversation(conversationId)
    if (!conv || !existsSync(conv.tmpDir)) return []
    const files = (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))
    const { readFile } = await import('fs/promises')
    const out: { name: string; dataUrl: string }[] = []
    for (const f of files) {
      const buf = await readFile(join(conv.tmpDir, f))
      out.push({ name: f, dataUrl: `data:image/png;base64,${buf.toString('base64')}` })
    }
    return out
  })

  // ---------- 文件选择 ----------
  ipcMain.handle(IPC.pickPsd, async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'PSD', extensions: ['psd'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })
  ipcMain.handle(IPC.pickDir, async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // ---------- 更新 ----------
  ipcMain.handle(IPC.checkUpdate, () => checkUpdate())
}
