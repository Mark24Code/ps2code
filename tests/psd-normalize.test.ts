import { describe, it, expect } from 'vitest'
import { normalizeTree, type RawLayer } from '../electron/services/psd/normalize'

describe('normalizeTree', () => {
  it('区分组与图层(有 children 即组)', () => {
    // 输入按文件顺序;输出反转为 PS 面板顺序(顶层在上),故 solo 在前、g 在后
    const raw: RawLayer[] = [
      { name: 'g', children: [{ name: 'leaf' }] },
      { name: 'solo' }
    ]
    const { tree } = normalizeTree(raw)
    expect(tree[0].name).toBe('solo')
    expect(tree[0].kind).toBe('layer')
    expect(tree[1].name).toBe('g')
    expect(tree[1].kind).toBe('group')
    expect(tree[1].children?.[0].kind).toBe('layer')
  })

  it('顺序与 PS 面板一致(反转文件存储顺序,顶层在上)', () => {
    // ag-psd 文件顺序:底 → 顶 = [bottom, middle, top]
    const raw: RawLayer[] = [{ name: 'bottom' }, { name: 'middle' }, { name: 'top' }]
    const { tree } = normalizeTree(raw)
    expect(tree.map((n) => n.name)).toEqual(['top', 'middle', 'bottom'])
  })

  it('计算 bounds 与宽高', () => {
    const raw: RawLayer[] = [{ name: 'a', left: 10, top: 20, right: 110, bottom: 220 }]
    const { tree } = normalizeTree(raw)
    expect(tree[0].width).toBe(100)
    expect(tree[0].height).toBe(200)
    expect(tree[0].bounds).toEqual({ left: 10, top: 20, right: 110, bottom: 220 })
  })

  it('负宽高被夹到 0', () => {
    const raw: RawLayer[] = [{ name: 'a', left: 100, right: 10, top: 100, bottom: 10 }]
    const { tree } = normalizeTree(raw)
    expect(tree[0].width).toBe(0)
    expect(tree[0].height).toBe(0)
  })

  it('hidden 精确映射为布尔', () => {
    // 反转后顺序为 [v, h]
    const { tree } = normalizeTree([{ name: 'h', hidden: true }, { name: 'v' }])
    const h = tree.find((n) => n.name === 'h')!
    const v = tree.find((n) => n.name === 'v')!
    expect(h.hidden).toBe(true)
    expect(v.hidden).toBe(false)
  })

  it('统计组数与层数(递归)', () => {
    const raw: RawLayer[] = [
      { name: 'g1', children: [{ name: 'l1' }, { name: 'g2', children: [{ name: 'l2' }] }] }
    ]
    const { groupCount, layerCount } = normalizeTree(raw)
    expect(groupCount).toBe(2) // g1, g2
    expect(layerCount).toBe(4) // g1, l1, g2, l2
  })

  it('生成路径式稳定 id(id 按展示顺序编号)', () => {
    const raw: RawLayer[] = [{ name: 'g', children: [{ name: 'a' }, { name: 'b' }] }]
    const { tree } = normalizeTree(raw)
    expect(tree[0].id).toBe('0')
    // 反转后子节点顺序为 [b, a],id 按展示顺序 0/0、0/1
    expect(tree[0].children?.[0].id).toBe('0/0')
    expect(tree[0].children?.[0].name).toBe('b')
    expect(tree[0].children?.[1].id).toBe('0/1')
    expect(tree[0].children?.[1].name).toBe('a')
  })

  it('未命名图层给占位名', () => {
    const { tree } = normalizeTree([{}])
    expect(tree[0].name).toBe('(未命名)')
  })

  it('空输入返回空树', () => {
    expect(normalizeTree(undefined)).toEqual({ tree: [], groupCount: 0, layerCount: 0 })
  })

  it('多次调用计数不串扰(无全局状态)', () => {
    const raw: RawLayer[] = [{ name: 'g', children: [{ name: 'l' }] }]
    const a = normalizeTree(raw)
    const b = normalizeTree(raw)
    expect(a.groupCount).toBe(b.groupCount)
    expect(a.layerCount).toBe(b.layerCount)
  })
})
