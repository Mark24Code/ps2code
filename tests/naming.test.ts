import { describe, it, expect } from 'vitest'
import { assignExportNames, dedupeFileName } from '../shared/naming'

describe('assignExportNames', () => {
  it('唯一名保持原样', () => {
    expect(assignExportNames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('重名追加 _01/_02 补零后缀', () => {
    expect(assignExportNames(['icon', 'icon', 'icon'])).toEqual(['icon_01', 'icon_02', 'icon_03'])
  })
  it('混合:仅重名的加后缀', () => {
    expect(assignExportNames(['btn', 'icon', 'btn'])).toEqual(['btn_01', 'icon', 'btn_02'])
  })
  it('超过 99 个重名时位数扩展为 3 位', () => {
    const names = Array(100).fill('x')
    const out = assignExportNames(names)
    expect(out[0]).toBe('x_001')
    expect(out[99]).toBe('x_100')
  })
})

describe('dedupeFileName', () => {
  it('不冲突则原样返回', () => {
    expect(dedupeFileName('a.png', new Set())).toBe('a.png')
  })
  it('冲突则追加 _01', () => {
    expect(dedupeFileName('a.png', new Set(['a.png']))).toBe('a_01.png')
  })
  it('连续冲突递增序号', () => {
    expect(dedupeFileName('a.png', new Set(['a.png', 'a_01.png']))).toBe('a_02.png')
  })
  it('@2x 命名:序号插在 @2x 之前', () => {
    expect(dedupeFileName('组名@2x.png', new Set(['组名@2x.png']))).toBe('组名_01@2x.png')
  })
  it('保留原始扩展名', () => {
    expect(dedupeFileName('logo.PNG', new Set(['logo.PNG']))).toBe('logo_01.PNG')
  })
})
