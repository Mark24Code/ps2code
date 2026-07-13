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
  name: string
}

export function mutateLayers(targetPath: string, ops: LayerOp[]): Promise<JsxResult> {
  return runScript('mutate-layers.jsx', { targetPath, ops })
}

export interface ExportParams {
  targetPath: string
  pattern?: string
  names?: string[]
  parent?: string  // 限定搜索范围:只在指定父组下查找
  x1: boolean
  x2: boolean
  trim: boolean
  outputDir: string
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

  // 解析 names:优先用传入的 names,否则用 pattern 从 PSD 元数据匹配
  let names = params.names || []
  if (names.length === 0 && params.pattern) {
    try {
      const meta = await readPsdMeta(params.targetPath)
      const regex = new RegExp(params.pattern)
      const walk = (nodes: typeof meta.tree): string[] => {
        const result: string[] = []
        for (const n of nodes) {
          if (n.kind === 'group' && regex.test(n.name)) result.push(n.name)
          if ((n as any).children) result.push(...walk((n as any).children))
        }
        return result
      }
      names = walk(meta.tree)
    } catch (e) {
      return { ok: false, data: { files: [], matched: 0, ok: 0, err: 0, outputDir: outputDir }, log: [], error: `无法读取 PSD 元数据: ${(e as Error).message}` }
    }
  }

  if (names.length === 0) {
    return { ok: false, data: { files: [], matched: 0, ok: 0, err: 0, outputDir: outputDir }, log: [], error: '没有匹配的图层组(请先用 list_layers 查询,或提供 names/pattern 参数)' }
  }

  const scriptPath = join(scriptsDir(), 'export-groups.sh')
  const namesArg = names.join(',')
  const args = [
    `--psd "${params.targetPath}"`,
    `--names "${namesArg}"`,
    `--output-dir "${outputDir}"`
  ]
  if (params.x1) args.push('--1x')
  if (params.x2) args.push('--2x')
  if (params.trim) args.push('--trim')
  if (params.parent) args.push(`--parent "${params.parent}"`)

  const cmd = `bash "${scriptPath}" ${args.join(' ')}`
  try {
    const { stdout } = await execAsync(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(stdout.trim()) as JsxResult<{
      files: string[]; meta?: { file: string; group: string; w: number; h: number; x: number; y: number }[]
      matched: number; ok: number; err: number; outputDir: string
    }>

    // 用实际文件路径的 basename 写 _meta.json(修正 ExtendScript 中文编码问题)
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
          return { file: segs[segs.length - 1], group: m.group, w: m.w, h: m.h, x: m.x, y: m.y }
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
  }
}

// Windows: 保留原 JSX 路径(通过 _common.jsxinc + runScript)
async function exportGroupsViaJsx(
  params: ExportParams
): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  return runScript('export-groups.jsx', {
    pattern: '',
    names: [],
    ...params
  })
}

export function exportGroups(
  params: ExportParams
): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  // 测试模式:走 JSX 路径(通过 FakeBridge,不依赖真实 Photoshop / shell)
  if (isUsingTestBridge()) {
    return exportGroupsViaJsx(params)
  }
  if (process.platform === 'darwin') {
    return exportGroupsViaShell(params)
  }
  return exportGroupsViaJsx(params)
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
