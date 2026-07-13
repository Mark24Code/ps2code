import { app, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, extname, join } from 'path'
import { copyFile, mkdir, readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { IPC } from '../shared/ipc'
import { dedupeFileName } from '../shared/naming'
import type { AgentStreamEvent, AppSettings, Conversation } from '../shared/types'
import * as db from './services/db'
import { readPsdMeta } from './services/psd'
import { getBridge } from './services/photoshop'
import { ensureDesignReady, testConnection } from './services/photoshop/operations'
import { cancelAgent, checkAgentConfig, resolveConfirm, runAgent } from './services/agent'
import { getLogs, logPath } from './services/agent/logStore'
import { checkUpdate } from './services/updater'
import { getMainWindow } from './main'

function convTmpDir(conversationId: string): string {
  return join(app.getPath('home'), '.ps2code', 'sessions', String(conversationId), 'tmp')
}

export function registerIpc(): void {
  // ---------- 通用 ----------
  ipcMain.handle(IPC.ping, () => 'pong')
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))

  // 读取本地文件并返回 base64 data URL(用于渲染进程展示本地图片)
  ipcMain.handle(IPC.readFileAsDataUrl, async (_e, filePath: string) => {
    const buf = await readFile(filePath)
    const ext = extname(filePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp'
    }
    const mime = mimeMap[ext] ?? 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  // ---------- 项目 ----------
  ipcMain.handle(IPC.projectImport, (_e, psdPath: string) => {
    const name = basename(psdPath).replace(/\.psd$/i, '')
    return db.importProject(psdPath, name)
  })
  ipcMain.handle(IPC.projectList, () => db.listProjects())
  ipcMain.handle(IPC.projectGet, (_e, id: number) => db.getProject(id))
  ipcMain.handle(IPC.projectUpdate, (_e, id: number, name: string) => db.updateProject(id, name))
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
  ipcMain.handle(IPC.convGet, (_e, id: string) => db.getConversation(id))
  ipcMain.handle(IPC.convUpdate, (_e, id: string, patch: Partial<Conversation>) =>
    db.updateConversation(id, patch)
  )
  ipcMain.handle(IPC.convDelete, (_e, id: string) => db.deleteConversation(id))

  // ---------- 消息 ----------
  ipcMain.handle(IPC.msgList, (_e, conversationId: string) => db.listMessages(conversationId))
  ipcMain.handle(IPC.msgAdd, (_e, m) => db.addMessage(m))

  // ---------- 设置 ----------
  ipcMain.handle(IPC.settingsGet, () => db.getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => db.setSettings(patch))

  // ---------- PSD ----------
  ipcMain.handle(IPC.psdRead, (_e, psdPath: string) => readPsdMeta(psdPath))

  // ---------- Photoshop ----------
  ipcMain.handle(IPC.psDetect, () => getBridge().detect())
  ipcMain.handle(IPC.psTest, () => testConnection())
  ipcMain.handle(IPC.psOpenDesign, (_e, psdPath: string) => ensureDesignReady(psdPath))

  // ---------- Agent ----------
  ipcMain.handle(
    IPC.agentSend,
    async (_e, payload: { conversationId: string; text: string }) => {
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
  ipcMain.handle(IPC.agentCancel, (_e, conversationId: string) => cancelAgent(conversationId))
  ipcMain.handle(
    IPC.agentCheck,
    (_e, draft?: { apiBaseUrl?: string; apiKey?: string; apiModel?: string }) =>
      checkAgentConfig(draft)
  )
  ipcMain.handle(IPC.agentLogs, (_e, conversationId: string) => getLogs(conversationId))
  ipcMain.handle(IPC.agentLogsPath, (_e, conversationId: string) => logPath(conversationId))

  // ---------- 导出确认: tmp → exportDir ----------
  ipcMain.handle(IPC.exportConfirm, async (_e, conversationId: string, names?: string[]) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const dest = conv.exportDir
    await mkdir(dest, { recursive: true })
    const files = existsSync(conv.tmpDir)
      ? (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))
      : []
    // 如果传了 names,只导出选中的文件
    const filtered = names ? files.filter((f) => names.includes(f)) : files
    // 已占用名集合:目标目录现有文件 + 本次已拷入的名字
    const taken = new Set<string>(existsSync(dest) ? await readdir(dest) : [])
    for (const f of filtered) {
      const name = dedupeFileName(f, taken)
      taken.add(name)
      await copyFile(join(conv.tmpDir, f), join(dest, name))
    }
    return { ok: true, dir: dest, count: filtered.length }
  })

  // ---------- 预览: 列出对话 tmp 下的 PNG,返回 dataURL + 元数据 ----------
  ipcMain.handle(IPC.previewList, async (_e, conversationId: string) => {
    const conv = db.getConversation(conversationId)
    if (!conv || !existsSync(conv.tmpDir)) return []
    const files = (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))
    const { readFile } = await import('fs/promises')

    // 读取导出元数据(尺寸/坐标)
    let metaMap: Record<string, { w: number; h: number; x: number; y: number }> = {}
    const metaPath = join(conv.tmpDir, '_meta.json')
    if (existsSync(metaPath)) {
      try {
        const metaRaw = await readFile(metaPath, 'utf8')
        const metaArr = JSON.parse(metaRaw) as { file: string; w: number; h: number; x: number; y: number }[]
        for (const m of metaArr) metaMap[m.file] = { w: m.w, h: m.h, x: m.x, y: m.y }
      } catch { /* ignore parse errors */ }
    }

    const out: { name: string; dataUrl: string; w?: number; h?: number; x?: number; y?: number }[] = []
    for (const f of files) {
      const buf = await readFile(join(conv.tmpDir, f))
      const meta = metaMap[f]
      out.push({
        name: f,
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        ...(meta || {})
      })
    }
    return out
  })

  // ---------- 预览删除: 删 tmp 下的图片并更新 _meta.json ----------
  ipcMain.handle(IPC.previewDelete, async (_e, conversationId: string, names: string[]) => {
    const conv = db.getConversation(conversationId)
    if (!conv || !existsSync(conv.tmpDir)) return { deleted: 0 }

    // 删除图片文件
    let deleted = 0
    for (const name of names) {
      const fp = join(conv.tmpDir, name)
      if (existsSync(fp)) {
        try { await unlink(fp); deleted++ } catch { /* skip locked files */ }
      }
    }

    // 修剪 _meta.json
    const metaPath = join(conv.tmpDir, '_meta.json')
    if (existsSync(metaPath)) {
      try {
        const { readFile: readMetaFile } = await import('fs/promises')
        const raw = await readMetaFile(metaPath, 'utf8')
        const arr = JSON.parse(raw) as { file: string; w: number; h: number; x: number; y: number }[]
        const nameSet = new Set(names)
        const pruned = arr.filter((m) => !nameSet.has(m.file))
        await writeFile(metaPath, JSON.stringify(pruned, null, 2), 'utf8')
      } catch { /* ignore */ }
    }

    return { deleted }
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
