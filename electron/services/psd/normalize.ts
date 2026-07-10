import type { PsdLayerNode } from '../../../shared/types'

// ag-psd 的 Layer 结构里我们关心的字段(避免直接依赖 ag-psd 类型,便于单测传入普通对象)
export interface RawLayer {
  name?: string
  hidden?: boolean
  left?: number
  top?: number
  right?: number
  bottom?: number
  children?: RawLayer[]
}

export interface NormalizeResult {
  tree: PsdLayerNode[]
  groupCount: number
  layerCount: number
}

function toNode(layer: RawLayer, id: string, counters: { groups: number; layers: number }): PsdLayerNode {
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const right = layer.right ?? 0
  const bottom = layer.bottom ?? 0
  const isGroup = Array.isArray(layer.children)

  counters.layers++
  if (isGroup) counters.groups++

  const node: PsdLayerNode = {
    id,
    name: layer.name ?? '(未命名)',
    kind: isGroup ? 'group' : 'layer',
    hidden: layer.hidden === true,
    bounds: { left, top, right, bottom },
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }

  if (isGroup && layer.children) {
    node.children = layer.children.map((c, i) => toNode(c, `${id}/${i}`, counters))
  }
  return node
}

// 把 ag-psd 的 children 规范化为 PsdLayerNode 树,并统计组数/层数(纯函数,无副作用)。
export function normalizeTree(children: RawLayer[] | undefined): NormalizeResult {
  const counters = { groups: 0, layers: 0 }
  const tree = (children ?? []).map((c, i) => toNode(c, `${i}`, counters))
  return { tree, groupCount: counters.groups, layerCount: counters.layers }
}
