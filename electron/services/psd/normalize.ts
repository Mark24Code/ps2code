import type { PsdLayerNode } from '../../../shared/types'

// ag-psd 的 Layer 结构里我们关心的字段(避免直接依赖 ag-psd 类型,便于单测传入普通对象)
export interface RawLayer {
  name?: string
  id?: number // ag-psd 的 layer id(PSD 原生 lyid)
  hidden?: boolean
  left?: number
  top?: number
  right?: number
  bottom?: number
  opacity?: number // 0-255
  blendMode?: string
  text?: { text?: string }
  fill?: string
  children?: RawLayer[]
}

export interface NormalizeResult {
  tree: PsdLayerNode[]
  groupCount: number
  layerCount: number
}

function toNode(
  layer: RawLayer,
  id: string,
  parentPath: string,
  counters: { groups: number; layers: number }
): PsdLayerNode {
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const right = layer.right ?? 0
  const bottom = layer.bottom ?? 0
  const isGroup = Array.isArray(layer.children)
  const name = layer.name ?? '(未命名)'
  const path = parentPath ? `${parentPath}/${name}` : name

  counters.layers++
  if (isGroup) counters.groups++

  // text layer content
  let layerText: string | undefined
  if (layer.text && typeof layer.text === 'object' && 'text' in layer.text) {
    layerText = (layer.text as { text?: string }).text
  }

  const node: PsdLayerNode = {
    id,
    // ag-psd 缺失或为 0 时视为无原生 id(0 不是合法 lyid)
    psId: typeof layer.id === 'number' && layer.id > 0 ? layer.id : undefined,
    path,
    name,
    kind: isGroup ? 'group' : 'layer',
    hidden: layer.hidden === true,
    bounds: { left, top, right, bottom },
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    opacity: typeof layer.opacity === 'number' ? layer.opacity : undefined,
    blendMode: layer.blendMode,
    text: layerText,
    fill: layer.fill
  }

  if (isGroup && layer.children) {
    // ag-psd 的 children 是文件存储顺序(底层在前),PS 面板是顶层在上,
    // 反转以与 PS 看到的顺序一致。
    node.children = layer.children
      .slice()
      .reverse()
      .map((c, i) => toNode(c, `${id}/${i}`, path, counters))
  }
  return node
}

// 把 ag-psd 的 children 规范化为 PsdLayerNode 树,并统计组数/层数(纯函数,无副作用)。
// 顶层同样反转,使整体顺序与 Photoshop 图层面板一致(顶层在上)。
export function normalizeTree(children: RawLayer[] | undefined): NormalizeResult {
  const counters = { groups: 0, layers: 0 }
  const tree = (children ?? [])
    .slice()
    .reverse()
    .map((c, i) => toNode(c, `${i}`, '', counters))
  return { tree, groupCount: counters.groups, layerCount: counters.layers }
}
