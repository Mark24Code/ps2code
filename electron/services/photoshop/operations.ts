import { readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { getBridge, isUsingTestBridge } from './index'
import { readPsdMeta } from '../psd'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface JsxResult<T = unknown> {
  ok: boolean
  data: T
  log: string[]
  error: string
}

// 定位 scripts/jsx 目录:开发态在项目根,打包后在 resources
function jsxDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'jsx')
  }
  return join(app.getAppPath(), 'scripts', 'jsx')
}

// 定位 scripts 目录(供 shell 脚本调用)
function scriptsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scripts')
  }
  return join(app.getAppPath(), 'scripts')
}

let commonCache: string | null = null
async function common(): Promise<string> {
  if (commonCache === null) {
    commonCache = await readFile(join(jsxDir(), '_common.jsxinc'), 'utf8')
  }
  return commonCache
}

// 拼接: _common + 参数注入 + 脚本体,执行并解析统一 JSON 返回
async function runScript<T>(scriptFile: string, params: unknown): Promise<JsxResult<T>> {
  const bridge = getBridge()
  const commonSrc = await common()
  const body = await readFile(join(jsxDir(), scriptFile), 'utf8')
  const paramsJson = JSON.stringify(params)
  // 用 JSON.stringify 再包一层,得到 JS 字符串字面量,注入为 PS2CODE_PARAMS
  const injected = `var PS2CODE_PARAMS = ${JSON.stringify(paramsJson)};`
  const full = `${commonSrc}\n${injected}\n${body}`
  const raw = await bridge.runJsx(full)
  try {
    return JSON.parse(raw) as JsxResult<T>
  } catch {
    // 脚本未按约定返回 JSON(如中途 alert),原样包装
    return { ok: false, data: {} as T, log: [], error: `无法解析脚本返回: ${raw}` }
  }
}

export interface RenameRule {
  from: string
  to: string
}

export function renameGroups(
  targetPath: string,
  rules: RenameRule[]
): Promise<JsxResult<{ rules: { from: string; to: string; count: number }[] }>> {
  return runScript('rename-groups.jsx', { targetPath, rules })
}

export interface LayerOp {
  action: 'hide' | 'show' | 'delete'
  name?: string
  psId?: number
}

export function mutateLayers(targetPath: string, ops: LayerOp[]): Promise<JsxResult> {
  return runScript('mutate-layers.jsx', { targetPath, ops })
}

// 修改文字图层内容:psId 优先定位,回退按 name。
export interface TextEdit {
  psId?: number
  name?: string
  text: string
}

export function setText(
  targetPath: string,
  edits: TextEdit[]
): Promise<JsxResult<{ edits: { target: string; ok: boolean; reason?: string; before?: string; after?: string }[] }>> {
  return runScript('set-text.jsx', { targetPath, edits })
}

// 合并图层组:把匹配的组(psId 优先,回退 name)各自合并为单个图层。
export interface MergeTarget {
  psId?: number
  name?: string
}

export function mergeGroups(
  targetPath: string,
  targets: MergeTarget[]
): Promise<JsxResult<{ merged: { target: string; ok: boolean; reason?: string }[] }>> {
  return runScript('merge-groups.jsx', { targetPath, targets })
}

// 单个导出目标:psId 用于在 PS 中精确定位(缺失则回退按名),
// exportName 为最终文件名基名(叶子名_节点id,已做非法字符清洗)。
// path/id 透传,便于导出后回写布局清单(无需从文件名反推)。
export interface ExportTargetParam {
  psId?: number
  name: string // 末端叶子图层/组名(psId 缺失时按此名定位)
  exportName: string // 文件名基名:叶子名_节点id
  path?: string // 图层名链路径
  id?: string // 路径式 id
}

export interface ExportParams {
  targetPath: string
  targets: ExportTargetParam[]
  x1: boolean
  x2: boolean
  trim: boolean
  outputDir: string
}

// 从 agentTools 传入的原始目标(含 path/id/psId)。
export interface RawExportTarget {
  psId?: number
  path: string
  id: string
  name: string
}

// 文件名清洗:去掉路径分隔符与非法字符(A/B/C → A_B_C)。
function sanitizeForFileName(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}

// 命名规则:叶子名_节点id。
//  - 有 psId:  叶子名_<psId>
//  - 无 psId:  叶子名_<路径式id,'/'→'_'>(保证唯一)
export function makeExportName(t: RawExportTarget): string {
  const leaf = sanitizeForFileName(t.name)
  const idPart =
    typeof t.psId === 'number' && t.psId > 0 ? String(t.psId) : sanitizeForFileName(t.id.replace(/\//g, '_'))
  return `${leaf}_${idPart}`
}

// 按导出文件名匹配回其目标:比较文件基名(去 @2x/.png,并容忍防覆盖追加的 _NN 序号)与 exportName。
export function matchTargetByFile(
  file: string,
  targets: ExportTargetParam[]
): ExportTargetParam | undefined {
  const base = file.replace(/@2x/i, '').replace(/\.png$/i, '')
  // 精确等于 exportName,或 exportName 后跟 _NN 防覆盖序号
  return targets.find(
    (t) => base === t.exportName || new RegExp(`^${escapeRe(t.exportName)}_\\d+$`).test(base)
  )
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 把 agentTools 的 targets 转成脚本需要的 ExportTargetParam(预计算 exportName,透传 path/id)。
export function toExportTargetParams(targets: RawExportTarget[]): ExportTargetParam[] {
  return targets.map((t) => ({
    psId: t.psId,
    name: t.name,
    exportName: makeExportName(t),
    path: t.path,
    id: t.id
  }))
}

// macOS: 使用 shell 脚本(自包含 JSX + sed + osascript)导出图层组。
// 沿用 export-group-84.sh 的成功模式:不用 _common.jsxinc、不用 eval、不依赖 PS2.params()。
async function exportGroupsViaShell(
  params: ExportParams
): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  // 兜底:outputDir 为空时自动生成(防止 DB 中 tmp_dir 未持久化的边缘情况)
  let outputDir: string = params.outputDir
  if (!outputDir) {
    const { randomUUID } = await import('crypto')
    outputDir = join(app.getPath('home'), '.ps2code', 'sessions', randomUUID(), 'tmp')
    await (await import('fs/promises')).mkdir(outputDir, { recursive: true })
  } else {
    // 确保目录存在
    const { mkdir } = await import('fs/promises')
    await mkdir(outputDir, { recursive: true })
  }

  if (!params.targets || params.targets.length === 0) {
    return { ok: false, data: { files: [], matched: 0, ok: 0, err: 0, outputDir: outputDir }, log: [], error: '没有可导出的目标(请先用 search_layers 定位)' }
  }

  // 目标(含 psId + 预计算 exportName)通过临时 JSON 文件传给 shell 脚本,避免 sed 注入结构化数据的脆弱性。
  const { writeFile, unlink } = await import('fs/promises')
  const { randomUUID } = await import('crypto')
  const { tmpdir } = await import('os')
  const targetsFile = join(tmpdir(), `ps2code-targets.${randomUUID()}.json`)
  await writeFile(targetsFile, JSON.stringify(params.targets), 'utf8')

  const scriptPath = join(scriptsDir(), 'export-groups.sh')
  const args = [
    `--psd "${params.targetPath}"`,
    `--targets-file "${targetsFile}"`,
    `--output-dir "${outputDir}"`
  ]
  if (params.x1) args.push('--1x')
  if (params.x2) args.push('--2x')
  if (params.trim) args.push('--trim')

  const cmd = `bash "${scriptPath}" ${args.join(' ')}`
  try {
    const { stdout } = await execAsync(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(stdout.trim()) as JsxResult<{
      files: string[]; meta?: { file: string; group: string; w: number; h: number; x: number; y: number }[]
      matched: number; ok: number; err: number; outputDir: string
    }>

    // 用实际文件路径的 basename 写 _meta.json(修正 ExtendScript 中文编码问题)
    // 并按 exportName 把 psId/path/id 附回每条(供布局清单 join,免去从文件名反推)。
    if (parsed.ok && parsed.data.meta && parsed.data.files) {
      try {
        const { writeFile, mkdir } = await import('fs/promises')
        const { dirname } = await import('path')
        const outDir = dirname(parsed.data.files[0])
        await mkdir(outDir, { recursive: true })
        const rebased = parsed.data.files.map((f, i) => {
          const m = parsed.data.meta![i]
          if (!m) return null
          const segs = f.split(/[/\\]/)
          const file = segs[segs.length - 1]
          const t = matchTargetByFile(file, params.targets)
          return {
            file,
            group: m.group,
            w: m.w,
            h: m.h,
            x: m.x,
            y: m.y,
            psId: t?.psId,
            path: t?.path,
            layerId: t?.id
          }
        }).filter(Boolean)
        await writeFile(outDir + '/_meta.json', JSON.stringify(rebased), 'utf8')
      } catch { /* best-effort: meta 写入失败不影响导出结果 */ }
    }

    return parsed
  } catch (e) {
    const errMsg = (e as Error).message
    // shell 脚本 JSON 输出到 stdout;若 execAsync 本身抛错(超时/信号),用 stderr 兜底
    if ('stderr' in (e as any)) {
      const stderr = (e as any).stderr as string
      try {
        return JSON.parse(stderr.trim()) as JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>
      } catch { /* fall through */ }
    }
    return { ok: false, data: { files: [], matched: 0, ok: 0, err: 0, outputDir: outputDir }, log: [], error: errMsg }
  } finally {
    // 清理临时 targets 文件
    try { await unlink(targetsFile) } catch { /* ignore */ }
  }
}

// Windows / 测试: JSX 路径(通过 _common.jsxinc + runScript),targets 直接进 PS2CODE_PARAMS。
async function exportGroupsViaJsx(
  params: ExportParams
): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  return runScript('export-groups.jsx', params)
}

// 对外入口:接收 agentTools 收集的 targets(含 path/id/psId),
// 在此计算 exportName(叶子名_节点id),再交给平台对应的脚本执行。
export function exportGroups(params: {
  targetPath: string
  targets: RawExportTarget[]
  x1: boolean
  x2: boolean
  trim: boolean
  outputDir: string
}): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  const resolved: ExportParams = {
    targetPath: params.targetPath,
    targets: toExportTargetParams(params.targets),
    x1: params.x1,
    x2: params.x2,
    trim: params.trim,
    outputDir: params.outputDir
  }
  // 测试模式:走 JSX 路径(通过 FakeBridge,不依赖真实 Photoshop / shell)
  if (isUsingTestBridge()) {
    return exportGroupsViaJsx(resolved)
  }
  if (process.platform === 'darwin') {
    return exportGroupsViaShell(resolved)
  }
  return exportGroupsViaJsx(resolved)
}

// 无害测试:返回 PS 版本
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const bridge = getBridge()
    const commonSrc = await common()
    const probe = `${commonSrc}\n(function(){ try { return PS2.result(true, { version: app.version }); } catch(e){ return PS2.result(false, {}, e.message);} })();`
    const raw = await bridge.runJsx(probe)
    const parsed = JSON.parse(raw) as JsxResult<{ version: string }>
    return {
      ok: parsed.ok,
      message: parsed.ok ? `Photoshop ${parsed.data.version} 连接正常` : parsed.error
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// 确保 Photoshop 已启动、且目标设计稿已打开(未开则打开,已开则置为当前文档)。
// 用于进入/切换对话时保证 PS 与设计稿就绪。
export async function ensureDesignReady(
  targetPath: string
): Promise<{ ok: boolean; message: string; docName?: string }> {
  try {
    const res = await runScript<{ docName: string; version: string }>('open-design.jsx', {
      targetPath
    })
    return {
      ok: res.ok,
      message: res.ok ? `已就绪:${res.data.docName}` : res.error,
      docName: res.data?.docName
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
