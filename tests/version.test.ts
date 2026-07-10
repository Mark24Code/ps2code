import { describe, it, expect } from 'vitest'
import { parseVersion, isNewer, pickLatest } from '../shared/version'

describe('parseVersion', () => {
  it('去掉 v 前缀并解析为数字数组', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })
  it('非法段落按 0 处理', () => {
    expect(parseVersion('v1.x.3')).toEqual([1, 0, 3])
  })
})

describe('isNewer', () => {
  it('主版本更大 → 新', () => {
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
  })
  it('次/修订版本比较', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.1.2', '1.1.1')).toBe(true)
  })
  it('相等 → 非新', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('v1.0.0', '1.0.0')).toBe(false)
  })
  it('更旧 → 非新', () => {
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
  })
  it('位数不等时按缺省 0 补齐', () => {
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.1', '1.2')).toBe(true)
  })
})

describe('pickLatest', () => {
  it('从一组 tag 里选最大版本', () => {
    expect(pickLatest(['v1.0.0', 'v1.2.0', 'v1.1.5'])).toBe('v1.2.0')
  })
  it('空数组返回 null', () => {
    expect(pickLatest([])).toBeNull()
  })
})
