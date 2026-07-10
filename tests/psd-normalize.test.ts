import { describe, it, expect } from 'vitest'
import { normalizeTree, type RawLayer } from '../electron/services/psd/normalize'

describe('normalizeTree', () => {
  it('区分组与图层(有 children 即组)', () => {
    const raw: RawLayer[] = [
      { name: 'g', children: [{ name: 'leaf' }] },
      { name: 'solo' }
    ]
    const { tree } = normalizeTree(raw)
    expect(tree[0].kind).toBe('group')
    expect(tree[0].children?.[0].kind).toBe('layer')
    expect(tree[1].kind).toBe('layer')
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
    const { tree } = normalizeTree([{ name: 'h', hidden: true }, { name: 'v' }])
    expect(tree[0].hidden).toBe(true)
    expect(tree[1].hidden).toBe(false)
  })

  it('统计组数与层数(递归)', () => {
    const raw: RawLayer[] = [
      { name: 'g1', children: [{ name: 'l1' }, { name: 'g2', children: [{ name: 'l2' }] }] }
    ]
    const { groupCount, layerCount } = normalizeTree(raw)
    expect(groupCount).toBe(2) // g1, g2
    expect(layerCount).toBe(4) // g1, l1, g2, l2
  })

  it('生成路径式稳定 id', () => {
    const raw: RawLayer[] = [{ name: 'g', children: [{ name: 'a' }, { name: 'b' }] }]
    const { tree } = normalizeTree(raw)
    expect(tree[0].id).toBe('0')
    expect(tree[0].children?.[0].id).toBe('0/0')
    expect(tree[0].children?.[1].id).toBe('0/1')
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
