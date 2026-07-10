import { readFile } from 'fs/promises'
import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdLayerNode, PsdMeta } from '../../../shared/types'

let groupCounter = 0

function toNode(layer: Layer, id: string): PsdLayerNode {
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const right = layer.right ?? 0
  const bottom = layer.bottom ?? 0
  const isGroup = Array.isArray(layer.children)
  if (isGroup) groupCounter++

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
    node.children = layer.children.map((c, i) => toNode(c, `${id}/${i}`))
  }
  return node
}

export async function readPsdMeta(psdPath: string): Promise<PsdMeta> {
  const buf = await readFile(psdPath)
  // 只取结构,跳过像素与合成图,快且省内存
  const psd: Psd = readPsd(buf, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  })

  groupCounter = 0
  const tree = (psd.children ?? []).map((c, i) => toNode(c, `${i}`))

  // 统计图层总数
  let layerCount = 0
  const count = (nodes: PsdLayerNode[]): void => {
    for (const n of nodes) {
      layerCount++
      if (n.children) count(n.children)
    }
  }
  count(tree)

  return {
    width: psd.width,
    height: psd.height,
    layerCount,
    groupCount: groupCounter,
    tree
  }
}
