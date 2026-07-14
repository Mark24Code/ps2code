import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { runPipeline } from '../electron/services/image/pipeline'

// 用 sharp 生成一张「未优化」的 PNG(低压缩级 + 随机噪声),确保有压缩空间。
async function makePng(path: string, size = 128): Promise<void> {
  const channels = 4
  const raw = Buffer.alloc(size * size * channels)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  const buf = await sharp(raw, { raw: { width: size, height: size, channels } })
    .png({ compressionLevel: 0 })
    .toBuffer()
  await writeFile(path, buf)
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ps2code-pipe-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('导出后处理流水线', () => {
  it('压缩:无损缩小 PNG 体积,且像素完全不变', async () => {
    const file = join(dir, 'a.png')
    await makePng(file)
    const before = (await stat(file)).size
    const pixelsBefore = await sharp(file).raw().toBuffer()

    const res = await runPipeline([file], { trim: false, compress: true })

    expect(res.ok).toBe(true)
    const after = (await stat(file)).size
    expect(after).toBeLessThanOrEqual(before) // 不会变大
    // 无损:重新解码的像素与压缩前逐字节一致
    const pixelsAfter = await sharp(file).raw().toBuffer()
    expect(Buffer.compare(pixelsBefore, pixelsAfter)).toBe(0)
    // 步骤结果记录
    expect(res.steps.length).toBe(1)
    expect(res.steps[0].step).toBe('compress')
    expect(res.steps[0].ok).toBe(true)
  })

  it('未勾选压缩:不产生任何步骤、文件保持不变', async () => {
    const file = join(dir, 'b.png')
    await makePng(file)
    const raw = await readFile(file)

    const res = await runPipeline([file], { trim: true, compress: false })

    expect(res.ok).toBe(true)
    expect(res.steps.length).toBe(0)
    // trim 仅记录一条“已在 PS 完成”的日志
    expect(res.log.some((l) => l.includes('裁剪'))).toBe(true)
    const after = await readFile(file)
    expect(Buffer.compare(raw, after)).toBe(0)
  })

  it('单个文件损坏不影响整体流程,只记为失败', async () => {
    const good = join(dir, 'good.png')
    const bad = join(dir, 'bad.png')
    await makePng(good)
    await writeFile(bad, Buffer.from('not a real png'))

    const res = await runPipeline([good, bad], { trim: false, compress: true })

    // 有失败项 → ok 为 false,但 good 仍被处理
    expect(res.ok).toBe(false)
    const goodStep = res.steps.find((s) => s.file === good)
    const badStep = res.steps.find((s) => s.file === bad)
    expect(goodStep?.ok).toBe(true)
    expect(badStep?.ok).toBe(false)
    expect(badStep?.error).toBeTruthy()
  })
})
