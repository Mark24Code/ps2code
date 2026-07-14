import type { PsdLayerNode, PsdMeta, LayoutManifest, LayoutItem } from '../../../shared/types'

// 导出脚本写的每文件元数据(<tmpDir>/_meta.json 每条)。
// psId/path/layerId 由 Node 侧在导出后按 exportName 附回(见 operations.ts),
// 免去从文件名反推,布局 join 更稳。
export interface ExportMetaEntry {
  file: string
  group: string
  w: number
  h: number
  x: number
  y: number
  psId?: number
  path?: string
  layerId?: string // 路径式 id
}

// 缓存树里一个节点的定位信息(按 psId / 路径式 id / 名字 匹配)。
interface NodeInfo {
  psId?: number
  path: string
  id: string
  name: string
  order: number // 展平顺序(顶层在上=靠前=order 小)
}

// 把树按"顶层在上"的展示顺序展平,记录每个节点的顺序号。
function flatten(tree: PsdLayerNode[]): NodeInfo[] {
  const out: NodeInfo[] = []
  const walk = (nodes: PsdLayerNode[]): void => {
    for (const n of nodes) {
      out.push({ psId: n.psId, path: n.path, id: n.id, name: n.name, order: out.length })
      if (n.children) walk(n.children)
    }
  }
  walk(tree)
  return out
}

// 从文件名推断倍率:@2x → 2,否则 1。
function scaleOf(file: string): number {
  return /@2x\.png$/i.test(file) ? 2 : 1
}

// 生成导出布局清单(纯函数,可单测)。
// metaData: 缓存树;metaEntries: 导出脚本的 _meta.json(已含 psId/path/layerId);
// onlyFiles: 仅保留这些最终文件名(可选)。
// 总节点数 N,zIndex = N - order,使"顶层在上"的节点获得更大的 zIndex(还原时压在上层)。
export function buildLayoutManifest(
  metaData: PsdMeta,
  metaEntries: ExportMetaEntry[],
  onlyFiles?: Set<string>
): LayoutManifest {
  const flat = flatten(metaData.tree)
  const total = flat.length

  // 匹配索引:psId、路径式 id、名字(用于查展平顺序算 zIndex)。
  const byPsId = new Map<number, NodeInfo>()
  const byId = new Map<string, NodeInfo>()
  const byName = new Map<string, NodeInfo>()
  for (const info of flat) {
    if (typeof info.psId === 'number') byPsId.set(info.psId, info)
    byId.set(info.id, info)
    if (!byName.has(info.name)) byName.set(info.name, info)
  }

  const items: LayoutItem[] = []
  for (const m of metaEntries) {
    if (onlyFiles && !onlyFiles.has(m.file)) continue

    // 优先用 _meta 里附回的 psId/layerId 定位节点(算 zIndex),回退按名。
    let node: NodeInfo | undefined
    if (typeof m.psId === 'number') node = byPsId.get(m.psId)
    if (!node && m.layerId) node = byId.get(m.layerId)
    if (!node) node = byName.get(m.group)

    const zIndex = node ? total - node.order : 0
    items.push({
      file: m.file,
      // psId/path 优先取 _meta 附回值,回退取匹配到的节点
      psId: m.psId ?? node?.psId,
      path: m.path ?? node?.path,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      zIndex,
      scale: scaleOf(m.file)
    })
  }

  return { canvas: { width: metaData.width, height: metaData.height }, items }
}
