import { readFile, writeFile, stat } from 'fs/promises'

// 导出后处理流水线。
//
// 语义:导出把图片写到对话 tmp 目录后,按对话勾选的选项对这些图片做「后处理」。
// 处理是一串有序步骤,顺序固定为:裁剪 → 压缩。
//   - 裁剪(trim):去掉四周透明边。目前在 Photoshop 导出阶段(JSX)完成,
//     这里保留为占位步骤,便于将来把裁剪也迁到后处理而不改变调用方。
//   - 压缩(compress):无损压缩 PNG(sharp / libvips),像素不变、仅缩小体积。
//
// 每个步骤对单个文件原地重写;单个文件失败只记录、不影响其它文件与其它步骤。

export interface PipelineOptions {
  trim: boolean // 目前由 PS 完成,这里为占位(见上)
  compress: boolean // 无损压缩 PNG
}

// 单个文件、单个步骤的处理结果(便于测试与日志)。
export interface StepResult {
  file: string
  step: 'compress'
  ok: boolean
  before: number // 处理前字节数
  after: number // 处理后字节数
  error?: string
}

export interface PipelineResult {
  ok: boolean
  steps: StepResult[]
  log: string[]
}

// 无损压缩单个 PNG:用 sharp 以最高压缩级重新编码,像素不变。
// 仅当产物更小时才写回,避免把已优化图片改大。
async function compressPng(filePath: string): Promise<StepResult> {
  const before = (await stat(filePath)).size
  const base: StepResult = { file: filePath, step: 'compress', ok: false, before, after: before }
  try {
    // 动态引入 sharp:仅在真正压缩时加载原生库,便于测试环境按需 mock/跳过。
    const sharp = (await import('sharp')).default
    const input = await readFile(filePath)
    const output = await sharp(input)
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toBuffer()
    if (output.length > 0 && output.length < before) {
      await writeFile(filePath, output)
      return { ...base, ok: true, after: output.length }
    }
    // 未变小:保留原文件,仍算成功(无需改动)。
    return { ...base, ok: true, after: before }
  } catch (e) {
    return { ...base, ok: false, error: (e as Error).message }
  }
}

// 对一批 PNG 文件(绝对路径)按选项跑流水线。顺序:裁剪 → 压缩。
export async function runPipeline(
  files: string[],
  options: PipelineOptions
): Promise<PipelineResult> {
  const steps: StepResult[] = []
  const log: string[] = []

  // 步骤 1:裁剪 —— 目前在 PS 导出阶段完成,这里不重复处理。
  if (options.trim) {
    log.push('裁剪:已在 Photoshop 导出阶段完成,跳过后处理裁剪')
  }

  // 步骤 2:压缩(无损 PNG)。
  if (options.compress) {
    let okCount = 0
    let saved = 0
    for (const f of files) {
      const r = await compressPng(f)
      steps.push(r)
      if (r.ok) {
        okCount++
        saved += r.before - r.after
      } else {
        log.push(`压缩失败 ${f}: ${r.error}`)
      }
    }
    const kb = (saved / 1024).toFixed(1)
    log.push(`压缩完成:${okCount}/${files.length} 张,共节省 ${kb} KB`)
  }

  const ok = steps.every((s) => s.ok)
  return { ok, steps, log }
}
