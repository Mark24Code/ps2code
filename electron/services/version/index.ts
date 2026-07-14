import { stat } from 'fs/promises'
import { createHash } from 'crypto'
import type { PsdLayerNode, VersionDiffLine, VersionDiffResult, VersionSnapshot } from '../../../shared/types'
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

  const snapshot = db.createVersionSnapshot(
    projectId,
    nextVersion,
    label,
    mtime,
    size,
    hash,
    layerTreeJson
  )

  return { created: true, snapshot }
}

export function listVersions(projectId: number): VersionSnapshot[] {
  return db.listVersionSnapshots(projectId)
}

/**
 * 计算某历史版本与最新版本之间的文本 diff
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

  return {
    baseVersion: baseRow.version,
    targetVersion: latestRow.version,
    lines,
    summary: { add, del, mod }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
