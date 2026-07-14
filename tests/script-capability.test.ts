import { describe, it, expect, beforeEach } from 'vitest'
import { setBridgeForTest, type PhotoshopBridge } from '../electron/services/photoshop'
import {
  renameGroups,
  exportGroups,
  mutateLayers,
  setText,
  mergeGroups
} from '../electron/services/photoshop/operations'

// 捕获最后一次执行的脚本内容 + 返回可控 JSON 的假 Bridge。
// 用于在无真实 Photoshop 的情况下验证「脚本能力可执行」的完整链路:
// operations 读取真实 .jsx 文件 → 注入参数 → 通过 Bridge 执行 → 解析统一 JSON 返回。
class FakeBridge implements PhotoshopBridge {
  lastScript = ''
  reply = ''
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
  fake = new FakeBridge()
  setBridgeForTest(fake)
})

describe('脚本能力可执行(通过 Bridge)', () => {
  it('rename_groups 组装真实 JSX + 参数并解析返回', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { rules: [{ from: '组84', to: '组184', count: 1 }] },
      log: ['OK 组84 -> 组184 (1 处)'],
      error: ''
    })
    const res = await renameGroups('/tmp/a.psd', [{ from: '组84', to: '组184' }])
    expect(res.ok).toBe(true)
    expect(res.data.rules[0].count).toBe(1)
    // 组装的脚本含公共库、参数注入、以及重命名脚本体
    expect(fake.lastScript).toContain('PS2CODE_PARAMS')
    expect(fake.lastScript).toContain('组84')
    expect(fake.lastScript).toContain('PS2.openOrReuse') // 来自 _common.jsxinc
    expect(fake.lastScript).toContain('renameIn') // 来自 rename-groups.jsx
  })

  it('export_groups 传递倍率/裁剪/输出目录参数', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/组84@2x.png'], matched: 1, ok: 1, err: 0, outputDir: '/out' },
      log: [],
      error: ''
    })
    const res = await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [{ psId: 84, path: '根组/组84', id: '0/0', name: '组84' }],
      x1: false,
      x2: true,
      trim: true,
      outputDir: '/out'
    })
    expect(res.ok).toBe(true)
    expect(res.data.files.length).toBe(1)
    // 文件名基名为 叶子名_节点id;脚本里含目标名与转智能对象逻辑
    expect(fake.lastScript).toContain('组84_84')
    expect(fake.lastScript).toContain('convertToSmartObject') // 来自 export-groups.jsx
  })

  it('mutate_layers 传递操作列表', async () => {
    fake.reply = JSON.stringify({ ok: true, data: {}, log: [], error: '' })
    const res = await mutateLayers('/tmp/a.psd', [{ action: 'hide', name: '组5' }])
    expect(res.ok).toBe(true)
    expect(fake.lastScript).toContain('组5')
    expect(fake.lastScript).toContain('hide')
  })

  it('mutate_layers 支持 psId 精确定位隐藏任意图层', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { ops: [{ action: 'hide', target: '#84', count: 1 }] },
      log: ['OK  hide #84 (1 处)'],
      error: ''
    })
    const res = await mutateLayers('/tmp/a.psd', [{ action: 'hide', psId: 84 }])
    expect(res.ok).toBe(true)
    // 脚本按 psId 走 selectLayerById,并能收集任意类型图层(collectByName)
    expect(fake.lastScript).toContain('selectLayerById')
    expect(fake.lastScript).toContain('collectByName')
  })

  it('set_text 组装脚本并传递文字修改列表', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { edits: [{ target: '标题', ok: true, before: '旧', after: '新文案' }] },
      log: ['OK  文字修改: 标题'],
      error: ''
    })
    const res = await setText('/tmp/a.psd', [{ name: '标题', text: '新文案' }])
    expect(res.ok).toBe(true)
    expect(res.data.edits[0].after).toBe('新文案')
    // 脚本含公共库、目标名/新文字,以及文字图层判定
    expect(fake.lastScript).toContain('新文案')
    expect(fake.lastScript).toContain('LayerKind.TEXT') // 来自 set-text.jsx
    expect(fake.lastScript).toContain('textItem.contents')
  })

  it('merge_groups 组装脚本并传递目标列表', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { merged: [{ target: '组5', ok: true }] },
      log: ['OK  合并图层组: 组5'],
      error: ''
    })
    const res = await mergeGroups('/tmp/a.psd', [{ name: '组5' }])
    expect(res.ok).toBe(true)
    expect(res.data.merged[0].ok).toBe(true)
    expect(fake.lastScript).toContain('组5')
    expect(fake.lastScript).toContain('.merge()') // 来自 merge-groups.jsx
    expect(fake.lastScript).toContain('LayerSet') // 判定为图层组
  })

  it('脚本返回非 JSON 时安全兜底', async () => {
    fake.reply = 'alert popped, not json'
    const res = await renameGroups('/tmp/a.psd', [{ from: 'x', to: 'y' }])
    expect(res.ok).toBe(false)
    expect(res.error).toContain('无法解析脚本返回')
  })

  // ---- 多格式回退导出路径相关测试 ----
  it('export_groups 主路径: exportLayerToFile 包含在组装脚本中', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/组84.png'], matched: 1, ok: 1, err: 0, outputDir: '/out' },
      log: [],
      error: ''
    })
    const res = await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [{ psId: 84, path: '根组/组84', id: '0/0', name: '组84' }],
      x1: true, x2: false, trim: true, outputDir: '/out'
    })
    expect(res.ok).toBe(true)
    expect(fake.lastScript).toContain('exportLayerToFile')
    // 主方案使用 SAVEFORWEB (与已验证的 backup 一致)
    expect(fake.lastScript).toContain('ExportOptionsSaveForWeb')
    expect(fake.lastScript).toContain('SAVEFORWEB')
    // 路径应为 .png(主方案已直接输出 PNG)
    expect(res.data.files[0]).toMatch(/\.png$/)
  })

  it('export_groups 路径:返回的实际路径保留原扩展名', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/first.png', '/out/second.png'], matched: 2, ok: 2, err: 0, outputDir: '/out' },
      log: [],
      error: ''
    })
    const res = await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [
        { psId: 1, path: 'first', id: '0', name: 'first' },
        { psId: 2, path: 'second', id: '1', name: 'second' }
      ],
      x1: true, x2: false, trim: false, outputDir: '/out'
    })
    expect(res.data.files.length).toBe(2)
    // 已经是 PNG 则无需转换
    expect(res.data.files[0]).toBe('/out/first.png')
    expect(res.data.files[1]).toBe('/out/second.png')
  })

  it('export_groups 回退路径:fallback 也使用 exportLayerToFile 多格式回退', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/组84.png'], matched: 1, ok: 1, err: 0, outputDir: '/out' },
      log: [],
      error: ''
    })
    await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [{ psId: 84, path: '根组/组84', id: '0/0', name: '组84' }],
      x1: true, x2: false, trim: true, outputDir: '/out'
    })
    // 回退函数 exportOneGroupFallback 也应使用 exportLayerToFile
    expect(fake.lastScript).toContain('exportLayerToFile')
    // exportOneGroupFallback 内应包含 exportLayerToFile 调用
    expect(fake.lastScript).toContain('exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName)')
    expect(fake.lastScript).toContain('exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName + "@2x")')
    // 不应包含旧的硬编码 exportPNG 函数名
    expect(fake.lastScript).not.toContain('exportAsTIFF')
  })

  it('export_groups 2x:只导出 2x 时路径正确', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/组84@2x.png'], matched: 1, ok: 1, err: 0, outputDir: '/out' },
      log: [],
      error: ''
    })
    const res = await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [{ psId: 84, path: '根组/组84', id: '0/0', name: '组84' }],
      x1: false, x2: true, trim: false, outputDir: '/out'
    })
    expect(res.ok).toBe(true)
    expect(res.data.files[0]).toMatch(/@2x\.png$/)
  })

  it('export_groups 导出失败:err>0 时 data.files 仍返回', async () => {
    fake.reply = JSON.stringify({
      ok: true,
      data: { files: ['/out/ok1.png'], matched: 3, ok: 1, err: 2, outputDir: '/out' },
      log: ['部分失败'],
      error: ''
    })
    const res = await exportGroups({
      targetPath: '/tmp/a.psd',
      targets: [
        { psId: 1, path: 'ok1', id: '0', name: 'ok1' },
        { psId: 2, path: 'bad1', id: '1', name: 'bad1' },
        { psId: 3, path: 'bad2', id: '2', name: 'bad2' }
      ],
      x1: true, x2: false, trim: false, outputDir: '/out'
    })
    expect(res.ok).toBe(true)
    expect(res.data.err).toBe(2)
    expect(res.data.files.length).toBe(1)
  })
})
