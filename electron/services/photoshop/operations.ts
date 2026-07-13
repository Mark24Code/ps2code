import { readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { getBridge } from './index'
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
  x1: boolean
  x2: boolean
  trim: boolean
  outputDir: string
}

export function exportGroups(
  params: ExportParams
): Promise<JsxResult<{ files: string[]; matched: number; ok: number; err: number; outputDir: string }>> {
  return runScript('export-groups.jsx', {
    pattern: '',
    names: [],
    ...params
  }).then(async (result) => {
    if (!result.ok || !result.data.files?.length) return result
    // 将各中间格式转为最终 PNG
    const pngFiles: string[] = []
    for (const filePath of result.data.files) {
      const ext = filePath.toLowerCase().split('.').pop()
      if (ext === 'png') {
        pngFiles.push(filePath) // 已直接输出 PNG,无需转换
      } else {
        try {
          const pngPath = await convertToPng(filePath)
          if (pngPath) pngFiles.push(pngPath)
        } catch {
          pngFiles.push(filePath.replace(/\.(tif|tiff|psd)$/i, '.png'))
        }
      }
    }
    return {
      ...result,
      data: { ...result.data, files: pngFiles }
    }
  })
}

// 测试用:注入假转换器(无需真实 sips/PowerShell)
export let convertToPngOverride: ((filePath: string) => Promise<string>) | null = null
export function setConvertToPngForTest(fn: ((filePath: string) => Promise<string>) | null): void {
  convertToPngOverride = fn
}

// 将图像文件转换为 PNG(macOS 用内置 sips,Windows 用 PowerShell)。
// 支持 TIFF / PSD 等中间格式。
async function convertToPng(filePath: string): Promise<string> {
  if (convertToPngOverride) return convertToPngOverride(filePath)
  const pngPath = filePath.replace(/\.(tif|tiff|psd)$/i, '.png')
  const ext = filePath.toLowerCase()
  if (!ext.endsWith('.tif') && !ext.endsWith('.tiff') && !ext.endsWith('.psd')) throw new Error('不支持的格式')

  if (process.platform === 'darwin') {
    // macOS 用 sips 转换(系统内置,无需额外安装)
    await execAsync(`sips -s format png "${tifPath}" --out "${pngPath}"`, { timeout: 30000 })
  } else if (process.platform === 'win32') {
    // Windows: 用 PowerShell + System.Drawing
    await execAsync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Bitmap]::FromFile('${tifPath.replace(/'/g, "''")}'); try { $img.Save('${pngPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); } finally { $img.Dispose(); }"`,
      { timeout: 30000 }
    )
  } else {
    // Linux/其他平台:复制一份(无实际转换,不失数据)
    await execAsync(`cp "${tifPath}" "${pngPath}"`, { timeout: 10000 })
  }
  return pngPath
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
