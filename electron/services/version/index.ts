import { stat } from 'fs/promises'
import { createHash } from 'crypto'
import type { LayerSummary, LayerSummaryItem, PsdLayerNode, VersionDiffLine, VersionDiffResult, VersionSnapshot } from '../../../shared/types'
import { readPsdMeta } from '../psd'
import * as db from '../db'

/* ============================================================
   层序列化：把图层树展平为缩进纯文本行（LCS diff 的输入）
   ============================================================ */

function serializeNode(node: PsdLayerNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth)
  out.push(`${pad}◈ ${node.name} (${node.kind})`)

  if (typeof node.opacity === 'number') {
    out.push(`${pad}    opacity = ${node.opacity}`)
  }
  if (node.blendMode) {
    out.push(`${pad}    blendMode = ${node.blendMode}`)
  }
  if (node.hidden) {
    out.push(`${pad}    hidden = true`)
  }
  if (node.bounds) {
    out.push(`${pad}    bounds = ${node.bounds.left},${node.bounds.top}  ${node.width}×${node.height}`)
  }
  if (node.fill) {
    out.push(`${pad}    fill = ${node.fill}`)
  }
  if (node.text !== undefined && node.text !== null) {
    out.push(`${pad}    text = "${node.text}"`)
  }

  if (node.children) {
    for (const child of node.children) {
      serializeNode(child, depth + 1, out)
    }
  }
}

export function serializeLayers(layers: PsdLayerNode[]): string[] {
  const lines: string[] = []
  for (const node of layers) {
    serializeNode(node, 0, lines)
  }
  return lines
}

/* ============================================================
   LCS 行 diff
   ============================================================ */

export function computeLineDiff(
  leftLines: string[],
  rightLines: string[]
): VersionDiffLine[] {
  const n = leftLines.length
  const m = rightLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = leftLines[i] === rightLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: { t: 'eq' | 'del' | 'ins'; l?: string; r?: string }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (leftLines[i] === rightLines[j]) {
      ops.push({ t: 'eq', l: leftLines[i], r: rightLines[j] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', l: leftLines[i] })
      i++
    } else {
      ops.push({ t: 'ins', r: rightLines[j] })
      j++
    }
  }
  while (i < n) { ops.push({ t: 'del', l: leftLines[i++] }) }
  while (j < m) { ops.push({ t: 'ins', r: rightLines[j++] }) }

  // 合并连续的 del/ins 成 chg 对（side-by-side 配对）
  const rows: VersionDiffLine[] = []
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op.t === 'eq') {
      rows.push({ left: op.l!, right: op.r!, type: 'eq' })
      k++
      continue
    }
    const dels: string[] = []
    const inses: string[] = []
    while (k < ops.length && (ops[k].t === 'del' || ops[k].t === 'ins')) {
      if (ops[k].t === 'del') dels.push(ops[k].l!)
      else inses.push(ops[k].r!)
      k++
    }
    const max = Math.max(dels.length, inses.length)
    for (let x = 0; x < max; x++) {
      rows.push({ left: dels[x] ?? null, right: inses[x] ?? null, type: 'chg' })
    }
  }

  return rows
}

/* ============================================================
   图层树 hash（确定性摘要，用于判断内容是否变化）
   ============================================================ */

export function computeLayerHash(layers: PsdLayerNode[]): string {
  const sha = createHash('sha1')
  // 递归收集关键字段到确定性字符串
  function walk(nodes: PsdLayerNode[]): void {
    for (const n of nodes) {
      sha.update(n.name)
      sha.update(n.kind)
      sha.update(String(n.hidden))
      if (n.opacity !== undefined) sha.update(String(n.opacity))
      if (n.blendMode) sha.update(n.blendMode)
      if (n.fill) sha.update(n.fill)
      if (n.text !== undefined && n.text !== null) sha.update(n.text)
      if (n.bounds) {
        sha.update(`${n.bounds.left},${n.bounds.top},${n.bounds.right},${n.bounds.bottom}`)
      }
      sha.update('\x00') // 节点分隔符
      if (n.children) walk(n.children)
    }
  }
  walk(layers)
  return sha.digest('hex')
}

/* ============================================================
   版本管理 API
   ============================================================ */

export interface CreateSnapshotResult {
  created: boolean
  snapshot: VersionSnapshot
}

/**
 * 检查 PSD 文件是否变化，如有变化则新建版本快照。
 * 两级判断：mtime/size → 图层 hash → 真正变化才创建。
 */
export async function createSnapshot(projectId: number): Promise<CreateSnapshotResult> {
  const project = db.getProject(projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  const st = await stat(project.psdPath)
  const mtime = st.mtime.toISOString().replace('T', ' ').slice(0, 16)
  const size = formatSize(st.size)

  const latest = db.getLatestVersionSnapshot(projectId)

  // 第一级：mtime + size 未变 → 认为无变化
  if (latest && latest.mtime === mtime && latest.size === size) {
    return { created: false, snapshot: latest }
  }

  // 读 PSD，解析图层
  const meta = await readPsdMeta(project.psdPath)
  const hash = computeLayerHash(meta.tree)

  // 第二级：图层 hash 未变 → 内容不变，不递增
  if (latest && latest.layerHash === hash) {
    return { created: false, snapshot: latest }
  }

  // 新建版本
  const nextVersion = latest ? latest.version + 1 : 1
  const label = `v${nextVersion}`
  const layerTreeJson = JSON.stringify(meta.tree)

  // 生成变更概要
  let changeMessage = ''
  if (latest) {
    try {
      const prevRow = db.getVersionSnapshotRow(projectId, latest.version)
      if (prevRow) {
        const prevLayers: PsdLayerNode[] = JSON.parse(prevRow.layerTree)
        const summary = computeLayerSummary(prevLayers, meta.tree)
        const parts: string[] = []
        if (summary.modified.length > 0) {
          const names = summary.modified.map((m) => m.name).slice(0, 3)
          parts.push(`修改${names.join('、')}${summary.modified.length > 3 ? '等' : ''}`)
        }
        if (summary.added.length > 0) {
          const names = summary.added.map((m) => m.name).slice(0, 2)
          parts.push(`新增${names.join('、')}${summary.added.length > 2 ? '等' : ''}`)
        }
        if (summary.deleted.length > 0) {
          const names = summary.deleted.map((m) => m.name).slice(0, 2)
          parts.push(`删除${names.join('、')}${summary.deleted.length > 2 ? '等' : ''}`)
        }
        changeMessage = parts.join('，').slice(0, 30)
      }
    } catch {
      /* 生成概要失败不阻断 */
    }
  }

  const snapshot = db.createVersionSnapshot(
    projectId,
    nextVersion,
    label,
    mtime,
    size,
    hash,
    layerTreeJson,
    changeMessage || undefined
  )

  return { created: true, snapshot }
}

export function listVersions(projectId: number): VersionSnapshot[] {
  return db.listVersionSnapshots(projectId)
}

/* ============================================================
   结构化图层对比（直接比较 PsdLayerNode 树，更可靠）
   ============================================================ */

interface FlatNode {
  id: string
  psId?: number
  name: string
  depth: number
  path: string
  node: PsdLayerNode
}

function flattenTree(nodes: PsdLayerNode[], depth: number, parentPath: string, out: FlatNode[]): void {
  for (const n of nodes) {
    const path = parentPath ? `${parentPath}/${n.name}` : n.name
    out.push({ id: n.id, psId: n.psId, name: n.name, depth, path, node: n })
    if (n.children) flattenTree(n.children, depth + 1, path, out)
  }
}

const ATTRS: (keyof PsdLayerNode)[] = ['opacity', 'blendMode', 'hidden', 'fill', 'text', 'bounds', 'width', 'height']

function attrVal(node: PsdLayerNode, key: string): string {
  const v = (node as any)[key]
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function compareAttributes(a: PsdLayerNode, b: PsdLayerNode): string[] {
  const changes: string[] = []
  for (const key of ATTRS) {
    const va = attrVal(a, key)
    const vb = attrVal(b, key)
    if (va !== vb) {
      if (key === 'bounds') {
        changes.push(`bounds: (${a.bounds?.left ?? 0},${a.bounds?.top ?? 0} ${a.width}×${a.height}) → (${b.bounds?.left ?? 0},${b.bounds?.top ?? 0} ${b.width}×${b.height})`)
      } else if (!va) {
        changes.push(`${key} = ${vb}（新增）`)
      } else if (!vb) {
        changes.push(`${key} = ${va}（已删除）`)
      } else {
        changes.push(`${key}: ${va} → ${vb}`)
      }
    }
  }
  return changes
}

function computeLayerSummary(baseLayers: PsdLayerNode[], latestLayers: PsdLayerNode[]): LayerSummary {
  const baseFlat: FlatNode[] = []
  const latestFlat: FlatNode[] = []
  flattenTree(baseLayers, 0, '', baseFlat)
  flattenTree(latestLayers, 0, '', latestFlat)

  // 建立两边索引：优先 psId，其次 path
  const baseByPsId = new Map<number, FlatNode>()
  const baseByPath = new Map<string, FlatNode>()
  const latestByPsId = new Map<number, FlatNode>()
  const latestByPath = new Map<string, FlatNode>()

  for (const f of baseFlat) {
    if (f.psId) baseByPsId.set(f.psId, f)
    baseByPath.set(f.path, f)
  }
  for (const f of latestFlat) {
    if (f.psId) latestByPsId.set(f.psId, f)
    latestByPath.set(f.path, f)
  }

  const matched = new Set<string>()
  const added: LayerSummaryItem[] = []
  const deleted: LayerSummaryItem[] = []
  const modified: LayerSummaryItem[] = []

  // 用 latest 做基准遍历,匹配 base
  for (const lf of latestFlat) {
    let match: FlatNode | undefined

    // 优先 psId 匹配
    if (lf.psId) {
      match = baseByPsId.get(lf.psId)
    }
    // 其次 path 匹配
    if (!match) {
      match = baseByPath.get(lf.path)
    }

    if (match) {
      matched.add(match.id)
      const changes = compareAttributes(match.node, lf.node)
      if (changes.length > 0) {
        modified.push({ name: lf.name, depth: lf.depth, changes })
      }
    } else {
      added.push({ name: lf.name, depth: lf.depth, changes: [] })
    }
  }

  // 没被匹配的 base 节点 = 被删除
  for (const bf of baseFlat) {
    if (!matched.has(bf.id)) {
      deleted.push({ name: bf.name, depth: bf.depth, changes: [] })
    }
  }

  return { added, deleted, modified }
}

/**
 * 计算某历史版本与最新版本之间的文本 diff + 结构化对比
 */
export function getDiff(projectId: number, baseVersion: number): VersionDiffResult {
  const baseRow = db.getVersionSnapshotRow(projectId, baseVersion)
  if (!baseRow) throw new Error(`Version ${baseVersion} not found`)
  const latest = db.getLatestVersionSnapshot(projectId)
  if (!latest) throw new Error('No latest version')
  const latestRow = db.getVersionSnapshotRowById(latest.id)
  if (!latestRow) throw new Error('Latest version full data not found')

  const baseLayers: PsdLayerNode[] = JSON.parse(baseRow.layerTree)
  const latestLayers: PsdLayerNode[] = JSON.parse(latestRow.layerTree)

  // 文本 diff（用于 side-by-side 展示）
  const baseText = serializeLayers(baseLayers)
  const latestText = serializeLayers(latestLayers)
  const lines = computeLineDiff(baseText, latestText)

  let add = 0, del = 0, mod = 0
  for (const line of lines) {
    if (line.type === 'chg') {
      if (line.left && line.right) mod++
      else if (line.left) del++
      else if (line.right) add++
    }
  }

  // 结构化图层对比（用于报告）
  const layerSummary = computeLayerSummary(baseLayers, latestLayers)

  return {
    baseVersion: baseRow.version,
    targetVersion: latestRow.version,
    lines,
    summary: { add, del, mod },
    layerSummary
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
