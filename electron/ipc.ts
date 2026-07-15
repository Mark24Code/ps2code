import { app, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, extname, join } from 'path'
import { copyFile, mkdir, readdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { IPC } from '../shared/ipc'
import { dedupeFileName } from '../shared/naming'
import type { AgentStreamEvent, AppSettings, ArchiveFolder, Conversation, RecutResult } from '../shared/types'
import * as db from './services/db'
import { readPsdMeta } from './services/psd'
import { buildLayerCache, getLayerMeta } from './services/psd/layerCache'
import { buildLayoutManifest, type ExportMetaEntry } from './services/psd/layout'
import * as versionService from './services/version'
import { getBridge } from './services/photoshop'
import { ensureDesignReady, testConnection } from './services/photoshop/operations'
import { exportGroups } from './services/photoshop/operations'
import type { RawExportTarget } from './services/photoshop/operations'
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
    const name = basename(psdPath).replace(/\.(psd|psb)$/i, '')
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

  // ---------- 图层缓存(每对话 layers.json) ----------
  // 进入对话:确保缓存存在(缺失则现读落盘)
  ipcMain.handle(IPC.layersPrepare, async (_e, conversationId: string) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const project = db.getProject(conv.projectId)
    if (!project) throw new Error('项目不存在')
    return getLayerMeta(conversationId, project.psdPath)
  })
  // 刷新:强制重建缓存(刷新按钮 / 回到 app)
  ipcMain.handle(IPC.layersRefresh, async (_e, conversationId: string) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const project = db.getProject(conv.projectId)
    if (!project) throw new Error('项目不存在')
    return buildLayerCache(conversationId, project.psdPath)
  })
  // 读取缓存(渲染层展示;缺失时回退现读并落盘)
  ipcMain.handle(IPC.layersGet, async (_e, conversationId: string) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const project = db.getProject(conv.projectId)
    if (!project) throw new Error('项目不存在')
    return getLayerMeta(conversationId, project.psdPath)
  })

  // ---------- Photoshop ----------
  ipcMain.handle(IPC.psDetect, () => getBridge().detect())
  ipcMain.handle(IPC.psTest, () => testConnection())
  ipcMain.handle(IPC.psOpenDesign, async (_e, psdPath: string) => {
    // Windows 上 DoJavaScript 的 app.open 可能受沙箱限制,走 COM 直开
    if (process.platform === 'win32') {
      const { execSync } = await import('child_process')
      const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
      const { join } = await import('path')
      const { tmpdir } = await import('os')
      const dir = mkdtempSync(join(tmpdir(), 'ps2code-ps-'))
      const ps1 = join(dir, 'open.ps1')
      const esc = psdPath.replace(/'/g, "''")
      const psScript = `$ErrorActionPreference = 'Stop'
$a = New-Object -ComObject Photoshop.Application
$a.Visible = $true
$found = $false
for ($i = 1; $i -le $a.Documents.Count; $i++) {
  if ($a.Documents.Item($i).FullName -eq '${esc}') { $found = $true; break }
}
if (-not $found) { $a.Open('${esc}') }
Write-Output 'OK'`
      writeFileSync(ps1, '﻿' + psScript, 'utf8')
      try {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { timeout: 30000 })
        return { ok: true, message: '已就绪' }
      } catch (e) {
        return { ok: false, message: `打开失败: ${(e as Error).message}` }
      } finally {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
      }
    }
    return ensureDesignReady(psdPath)
  })
  ipcMain.handle(IPC.psActivate, async () => {
    await getBridge().activate()
  })

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
    (_e, draft?: { apiProvider?: string; apiKey?: string; apiModel?: string }) =>
      checkAgentConfig(draft)
  )
  ipcMain.handle(IPC.agentLogs, (_e, conversationId: string) => getLogs(conversationId))
  ipcMain.handle(IPC.agentLogsPath, (_e, conversationId: string) => logPath(conversationId))

  // ---------- 导出确认: tmp → exportDir ----------
  ipcMain.handle(IPC.exportConfirm, async (_e, conversationId: string, names?: string[]) => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const project = db.getProject(conv.projectId)
    const dest = conv.exportDir
    await mkdir(dest, { recursive: true })
    const files = existsSync(conv.tmpDir)
      ? (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))
      : []
    // 如果传了 names,只导出选中的文件
    const filtered = names ? files.filter((f) => names.includes(f)) : files
    // 已占用名集合:目标目录现有文件 + 本次已拷入的名字
    const taken = new Set<string>(existsSync(dest) ? await readdir(dest) : [])
    // tmp 文件名 → 最终落地文件名(去重后),用于回写布局清单
    const tmpToFinal = new Map<string, string>()
    for (const f of filtered) {
      const name = dedupeFileName(f, taken)
      taken.add(name)
      tmpToFinal.set(f, name)
      await copyFile(join(conv.tmpDir, f), join(dest, name))
    }

    // ---- 生成导出布局清单 layout.json(位置/尺寸/psId/zIndex/scale,便于还原) ----
    try {
      const metaPath = join(conv.tmpDir, '_meta.json')
      if (project && existsSync(metaPath)) {
        const rawMeta = await readFile(metaPath, 'utf8')
        const metaEntries = JSON.parse(rawMeta) as ExportMetaEntry[]
        // 只保留本次实际导出的 tmp 文件,并把文件名换成最终落地名
        const finalEntries = metaEntries
          .filter((m) => tmpToFinal.has(m.file))
          .map((m) => ({ ...m, file: tmpToFinal.get(m.file)! }))
        const layerMeta = await getLayerMeta(conversationId, project.psdPath)
        const manifest = buildLayoutManifest(layerMeta, finalEntries)
        await writeFile(join(dest, 'layout.json'), JSON.stringify(manifest, null, 2), 'utf8')
      }
    } catch {
      /* 布局清单为附加产物,失败不影响导出结果 */
    }

    return { ok: true, dir: dest, count: filtered.length }
  })

  // ---------- 预览: 列出对话 tmp 下的 PNG,按导出顺序排列(新→旧) ----------
  ipcMain.handle(IPC.previewList, async (_e, conversationId: string) => {
    const conv = db.getConversation(conversationId)
    if (!conv || !existsSync(conv.tmpDir)) return []
    const files = (await readdir(conv.tmpDir)).filter((f) => f.toLowerCase().endsWith('.png'))

    // 读取导出元数据(尺寸/坐标),其数组顺序即导出顺序(后导出=新)
    let metaOrder: string[] = []
    let metaMap: Record<string, { w: number; h: number; x: number; y: number }> = {}
    const metaPath = join(conv.tmpDir, '_meta.json')
    if (existsSync(metaPath)) {
      try {
        const metaRaw = await readFile(metaPath, 'utf8')
        const metaArr = JSON.parse(metaRaw) as { file: string; w: number; h: number; x: number; y: number }[]
        metaOrder = metaArr.map((m) => m.file)
        for (const m of metaArr) metaMap[m.file] = { w: m.w, h: m.h, x: m.x, y: m.y }
      } catch { /* ignore parse errors */ }
    }

    // 排序:有 metaOrder 则按导出顺序(后导出→前),否则按 readdir 顺序取反
    let sortedFiles: string[]
    if (metaOrder.length > 0) {
      // 只取 metaOrder 中存在的文件;不在其中的追加到末尾
      const inMeta = metaOrder.filter((f) => files.includes(f))
      const notInMeta = files.filter((f) => !metaOrder.includes(f)).reverse()
      sortedFiles = [...inMeta.reverse(), ...notInMeta]
    } else {
      sortedFiles = [...files].reverse()
    }

    const out: { name: string; dataUrl: string; w?: number; h?: number; x?: number; y?: number; seq: number }[] = []
    for (let idx = 0; idx < sortedFiles.length; idx++) {
      const f = sortedFiles[idx]
      const buf = await readFile(join(conv.tmpDir, f))
      const meta = metaMap[f]
      out.push({
        name: f,
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        ...(meta || {}),
        seq: sortedFiles.length - idx // seq 越大越新
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
      filters: [{ name: 'Photoshop', extensions: ['psd', 'psb'] }]
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

  // ---------- 版本管理 ----------
  // 检查 PSD 是否变化(聚焦触发):stat → hash → 变化则创建新版本
  ipcMain.handle(IPC.versionsCheck, async (_e, projectId: number) =>
    versionService.createSnapshot(projectId)
  )
  ipcMain.handle(IPC.versionsList, (_e, projectId: number) =>
    versionService.listVersions(projectId)
  )
  ipcMain.handle(IPC.versionsDiff, (_e, projectId: number, baseVersion: number) =>
    versionService.getDiff(projectId, baseVersion)
  )

  // ---------- 归档 ----------
  /** 归档目录: ~/.ps2code/archives/<convId>/ */
  function archivesDir(conversationId: string): string {
    return join(app.getPath('home'), '.ps2code', 'archives', String(conversationId))
  }

  /** 创建归档(共享逻辑,供 IPC handler 和 recut handler 复用) */
  async function createArchive(conversationId: string): Promise<string> {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    if (!existsSync(conv.tmpDir)) throw new Error('没有可归档的导出文件')

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    const archiveName = `自动重切备份:${ts}`
    const archiveDir = join(archivesDir(conversationId), archiveName)
    await mkdir(archiveDir, { recursive: true })

    const files = await readdir(conv.tmpDir)
    let copied = 0
    for (const f of files) {
      const src = join(conv.tmpDir, f)
      if (!existsSync(src)) continue
      try {
        await copyFile(src, join(archiveDir, f))
        copied++
      } catch { /* 跳过无法复制的文件 */ }
    }
    if (copied === 0) throw new Error('归档失败:无法复制任何文件')
    return archiveDir
  }

  // 列出所有归档文件夹
  ipcMain.handle(IPC.previewArchiveList, async (_e, conversationId: string): Promise<ArchiveFolder[]> => {
    const dir = archivesDir(conversationId)
    if (!existsSync(dir)) return []
    const entries = await readdir(dir, { withFileTypes: true })
    const folders: ArchiveFolder[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderPath = join(dir, entry.name)
      const files = await readdir(folderPath)
      const pngCount = files.filter((f) => f.toLowerCase().endsWith('.png')).length
      folders.push({
        name: entry.name,
        path: folderPath,
        fileCount: pngCount,
        createdAt: entry.name.replace(/^自动重切备份:/, '')
      })
    }
    return folders.sort((a, b) => b.name.localeCompare(a.name))
  })

  // 创建归档
  ipcMain.handle(IPC.previewArchiveCreate, async (_e, conversationId: string): Promise<{ path: string }> => {
    const path = await createArchive(conversationId)
    return { path }
  })

  // ---------- 重切 ----------
  function emitRecutProgress(conversationId: string, progress: import('../shared/types').RecutProgress): void {
    getMainWindow()?.webContents.send(IPC.recutStream, { conversationId, progress })
  }

  // 基于已有 _meta.json 重新切图
  ipcMain.handle(IPC.previewRecut, async (_e, conversationId: string): Promise<RecutResult> => {
    const conv = db.getConversation(conversationId)
    if (!conv) throw new Error('对话不存在')
    const project = db.getProject(conv.projectId)
    if (!project) throw new Error('项目不存在')

    const metaPath = join(conv.tmpDir, '_meta.json')
    if (!existsSync(metaPath)) {
      throw new Error('找不到导出元数据(_meta.json)，请先让 Agent 导出图片后再试')
    }

    // 1. 读取 _meta.json 恢复导出目标
    emitRecutProgress(conversationId, { step: 'archive', message: '正在读取导出配置...' })
    const rawMeta = await readFile(metaPath, 'utf8')
    const metaEntries: ExportMetaEntry[] = JSON.parse(rawMeta)
    if (metaEntries.length === 0) {
      throw new Error('导出配置为空，没有可重切的图片')
    }

    const targets: RawExportTarget[] = metaEntries.map((m) => ({
      psId: m.psId,
      path: m.path || '',
      id: m.layerId || m.group,
      name: m.group
    }))

    // 2. 归档
    emitRecutProgress(conversationId, { step: 'archive', message: '正在归档当前导出...' })
    let archivePath = ''
    try {
      archivePath = await createArchive(conversationId)
    } catch (e) {
      throw new Error(`归档失败: ${(e as Error).message}`)
    }

    // 清空 tmpDir
    emitRecutProgress(conversationId, { step: 'recut', message: '准备重新导出...' })
    try {
      const oldFiles = await readdir(conv.tmpDir)
      for (const f of oldFiles) {
        try { await rm(join(conv.tmpDir, f), { force: true }) } catch { /* */ }
      }
    } catch { /* */ }

    // 3. 调用 exportGroups
    emitRecutProgress(conversationId, {
      step: 'recut', message: '正在调用 Photoshop 重新切图...',
      total: targets.length, current: 0
    })

    const successes: string[] = []
    const failures: { name: string; reason: string }[] = []
    const BATCH_SIZE = 10
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE)
      try {
        const result = await exportGroups({
          targetPath: project.psdPath,
          targets: batch,
          x1: conv.opt1x, x2: conv.opt2x,
          trim: conv.optTrim, compress: conv.optCompress,
          outputDir: conv.tmpDir
        })

        if (result.ok && result.data) {
          for (const tf of result.data.files || []) successes.push(tf)
        }
        if (result.log) {
          for (const line of result.log) {
            if (line.includes('✕') || line.includes('未找到') || line.includes('未定位')) {
              failures.push({ name: line, reason: line })
            }
          }
        }
        if (result.data.err > 0) {
          const exportedCount = (result.data.files || []).length
          const expectedCount = batch.length * (conv.opt1x && conv.opt2x ? 2 : conv.opt1x || conv.opt2x ? 1 : 2)
          if (exportedCount < expectedCount) {
            for (const t of batch) {
              const hasFile = (result.data.files || []).some((f: string) =>
                f.toLowerCase().includes(t.name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '_'))
              )
              if (!hasFile) failures.push({ name: t.name, reason: '图层可能已被修改或删除，未找到匹配项' })
            }
          }
        }
      } catch (e) {
        for (const t of batch) failures.push({ name: t.name, reason: `导出异常: ${(e as Error).message}` })
      }

      emitRecutProgress(conversationId, {
        step: 'recut',
        message: `正在重切...(${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length})`,
        total: targets.length,
        current: Math.min(i + BATCH_SIZE, targets.length),
        failures: failures.length > 0 ? failures : undefined,
        successes: successes.length > 0 ? successes : undefined
      })
    }

    emitRecutProgress(conversationId, {
      step: 'done',
      message: `重切完成。成功: ${successes.length} 个, 失败: ${failures.length} 个`,
      successes, failures
    })

    return { successes, failures, archivePath }
  })
}
