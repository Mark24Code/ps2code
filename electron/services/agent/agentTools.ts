import type { AgentStreamEvent } from '../../../shared/types'
import { getConversation } from '../db'
import { getLayerMeta } from '../psd/layerCache'
import type { PsdLayerNode } from '../../../shared/types'
import {
  exportGroups,
  exportSelection,
  mutateLayers,
  renameGroups,
  setText,
  mergeGroups,
  type RenameRule,
  type LayerOp,
  type TextEdit,
  type MergeTarget
} from '../photoshop/operations'

// 一条搜索命中结果:收集图层名链路径与 psd 原生 id,供确认与导出使用。
export interface LayerHit {
  path: string // 图层名链路径,如 "根组/x默认/1"
  psId?: number // psd 原生 id(lyid),用于在 PS 中精确定位;可能缺失
  id: string // 路径式 id,如 "0/2/1"(psId 缺失时的回退定位/命名依据)
  name: string // 末端(叶子)图层/组名
  kind: 'group' | 'layer'
  hidden: boolean
  bounds: PsdLayerNode['bounds']
  width: number
  height: number
}

// 导出目标:定位用 psId(缺失回退路径式 id),命名用 叶子名_节点id。
export interface ExportTarget {
  psId?: number
  path: string
  id: string
  name: string
}

// 搜索模式:模糊(子串,大小写不敏感)/ 正则。
export type SearchMode = 'fuzzy' | 'regex'

// 在树上按名称匹配收集命中(可选父范围:先定位父节点,再只在其子树里搜索)。
export function searchInTree(
  tree: PsdLayerNode[],
  query: string,
  mode: SearchMode,
  parent?: string
): LayerHit[] {
  // 谓词:模糊 = 子串(大小写不敏感);正则 = 用 query 构造 RegExp。
  let test: (name: string) => boolean
  if (mode === 'regex') {
    const re = new RegExp(query)
    test = (name) => re.test(name)
  } else {
    const q = query.toLowerCase()
    test = (name) => name.toLowerCase().includes(q)
  }

  const toHit = (n: PsdLayerNode): LayerHit => ({
    path: n.path,
    psId: n.psId,
    id: n.id,
    name: n.name,
    kind: n.kind,
    hidden: n.hidden,
    bounds: n.bounds,
    width: n.width,
    height: n.height
  })

  const collect = (nodes: PsdLayerNode[], out: LayerHit[]): void => {
    for (const n of nodes) {
      if (test(n.name)) out.push(toHit(n))
      if (n.children) collect(n.children, out)
    }
  }

  // 父范围:先找到所有名称匹配 parent 的节点,再在它们的子树里搜索。
  let roots: PsdLayerNode[] = tree
  if (parent && parent.length > 0) {
    const parents: PsdLayerNode[] = []
    const findParents = (nodes: PsdLayerNode[]): void => {
      for (const n of nodes) {
        if (n.name === parent) parents.push(n)
        if (n.children) findParents(n.children)
      }
    }
    findParents(tree)
    roots = parents.flatMap((p) => p.children ?? [])
  }

  const hits: LayerHit[] = []
  collect(roots, hits)
  return hits
}

// Agent 工具处理逻辑,抽成可复用/可测的纯逻辑单元。
// runAgent 用它注册到 SDK;测试直接调用其中的 handler 验证「对话可调用脚本」。

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface ToolDeps {
  targetPath: string
  conversationId: string
  emit: (e: AgentStreamEvent) => void
  // 破坏性操作确认(返回 true 才执行)。默认允许(测试可注入拒绝)。
  requestConfirm?: (prompt: string, payload: unknown) => Promise<boolean>
}

export function createToolHandlers(deps: ToolDeps) {
  const { targetPath, conversationId, emit } = deps
  const confirm = deps.requestConfirm ?? (async () => true)

  return {
    // 图层搜索:把用户意图转成 模糊/正则/父范围 的标准匹配,返回命中(含 path + psId)。
    async searchLayers(args: {
      query: string
      mode?: SearchMode
      parent?: string
    }): Promise<ToolResult> {
      const meta = await getLayerMeta(conversationId, targetPath)
      const mode: SearchMode = args.mode === 'regex' ? 'regex' : 'fuzzy'
      let hits: LayerHit[]
      try {
        hits = searchInTree(meta.tree, args.query, mode, args.parent)
      } catch (e) {
        return {
          content: [{ type: 'text', text: `搜索失败(正则无效?): ${(e as Error).message}` }],
          isError: true
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query: args.query,
              mode,
              parent: args.parent ?? null,
              count: hits.length,
              hits
            })
          }
        ]
      }
    },

    async listLayers(args: { pattern?: string }): Promise<ToolResult> {
      const meta = await getLayerMeta(conversationId, targetPath)
      // 返回完整层级树（含 id/psId/path/name/kind/hidden/children），
      // 让 AI 理解层级关系并拿到 psId 用于精确导出
      const simplifyTree = (nodes: PsdLayerNode[]): unknown[] => {
        return nodes.map(n => {
          const node: Record<string, unknown> = {
            id: n.id,
            psId: n.psId,
            path: n.path,
            name: n.name,
            kind: n.kind,
            hidden: n.hidden
          }
          if (n.children) node.children = simplifyTree(n.children)
          return node
        })
      }
      const tree = simplifyTree(meta.tree)
      return { content: [{ type: 'text', text: JSON.stringify({ tree }) }] }
    },

    async renameGroups(args: { rules: RenameRule[] }): Promise<ToolResult> {
      const res = await renameGroups(targetPath, args.rules)
      emit({ type: 'tool_result', name: 'rename_groups', text: res.log.join('\n') })
      return { content: [{ type: 'text', text: JSON.stringify(res.data) }], isError: !res.ok }
    },

    async mutateLayers(args: { ops: LayerOp[] }): Promise<ToolResult> {
      const hasDestructive = args.ops.some((o) => o.action === 'delete')
      if (hasDestructive) {
        const approved = await confirm(
          `即将删除图层组: ${args.ops
            .filter((o) => o.action === 'delete')
            .map((o) => o.name)
            .join(', ')}。此操作会保存文件,是否继续?`,
          args.ops
        )
        if (!approved) {
          return { content: [{ type: 'text', text: '用户取消了删除操作' }] }
        }
      }
      const res = await mutateLayers(targetPath, args.ops)
      emit({ type: 'tool_result', name: 'mutate_layers', text: res.log.join('\n') })
      return { content: [{ type: 'text', text: JSON.stringify(res.data) }], isError: !res.ok }
    },

    // 修改文字图层内容。改动设计稿,需用户同意(由 Agent 在对话中确认后调用)。
    async setText(args: { edits: TextEdit[] }): Promise<ToolResult> {
      const res = await setText(targetPath, args.edits)
      emit({ type: 'tool_result', name: 'set_text', text: res.log.join('\n') })
      return { content: [{ type: 'text', text: JSON.stringify(res.data) }], isError: !res.ok }
    },

    // 合并图层组为单个图层。不可逆(组内结构丢失),先请求用户确认。
    async mergeGroups(args: { targets: MergeTarget[] }): Promise<ToolResult> {
      const label = args.targets
        .map((t) => t.name ?? `#${t.psId}`)
        .join(', ')
      const approved = await confirm(
        `即将合并图层组: ${label}。合并后组内图层会被压平为单个图层且不可撤销,并会保存文件,是否继续?`,
        args.targets
      )
      if (!approved) {
        return { content: [{ type: 'text', text: '用户取消了合并操作' }] }
      }
      const res = await mergeGroups(targetPath, args.targets)
      emit({ type: 'tool_result', name: 'merge_groups', text: res.log.join('\n') })
      return { content: [{ type: 'text', text: JSON.stringify(res.data) }], isError: !res.ok }
    },

    // 导出:优先用 search_layers 命中的 targets(含 psId 用于精确定位、path/id 用于命名);
    // 兼容旧的 pattern/names/parent(会先在 Node 侧转成 targets)。
    async exportGroups(args: {
      targets?: ExportTarget[]
      pattern?: string
      names?: string[]
      parent?: string
    }): Promise<ToolResult> {
      const cur = getConversation(conversationId)!
      let targets = args.targets ?? []

      // 未显式给 targets 时,用 pattern/names(可选 parent)在 Node 侧搜索转成 targets。
      if (targets.length === 0) {
        const meta = await getLayerMeta(conversationId, targetPath)
        const seen = new Set<string>()
        const pushHits = (hits: LayerHit[]): void => {
          for (const h of hits) {
            const key = h.id
            if (seen.has(key)) continue
            seen.add(key)
            targets.push({ psId: h.psId, path: h.path, id: h.id, name: h.name })
          }
        }
        if (args.pattern) pushHits(searchInTree(meta.tree, args.pattern, 'regex', args.parent))
        if (args.names && args.names.length) {
          for (const nm of args.names) {
            // names 视为精确名:用锚定正则匹配整名
            const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            pushHits(searchInTree(meta.tree, `^${esc}$`, 'regex', args.parent))
          }
        }
      }

      if (targets.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: '没有可导出的目标。请先用 search_layers 定位图层并传入 targets,或提供 pattern/names。'
            }
          ],
          isError: true
        }
      }

      const res = await exportGroups({
        targetPath,
        targets,
        x1: cur.opt1x,
        x2: cur.opt2x,
        trim: cur.optTrim,
        compress: cur.optCompress,
        outputDir: cur.tmpDir
      })
      emit({ type: 'tool_result', name: 'export_groups', text: res.log.join('\n') })
      // 把日志细节也注入到返回数据中,方便 Agent 定位失败原因
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...res.data, _log: res.log }) }],
        isError: !res.ok || res.data.err > 0
      }
    },

    // 按选区导出:用户先在 Photoshop 中框选区域(矩形选框/套索等),然后调用此工具只导出选区范围内的目标图层。
    // 与 exportGroups 不同,此工具需要用户在 PS 中有激活的选区才会生效。
    async exportSelection(args: {
      targets: ExportTarget[]
    }): Promise<ToolResult> {
      const cur = getConversation(conversationId)!
      const targets = args.targets ?? []

      if (targets.length === 0) {
        return {
          content: [{ type: 'text', text: '没有可导出的目标。请先用 search_layers 定位图层并传入 targets。' }],
          isError: true
        }
      }

      const res = await exportSelection({
        targetPath,
        targets,
        x1: cur.opt1x,
        x2: cur.opt2x,
        trim: cur.optTrim,
        outputDir: cur.tmpDir
      })
      emit({ type: 'tool_result', name: 'export_selection', text: res.log.join('\n') })
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...res.data, _log: res.log }) }],
        isError: !res.ok || res.data.err > 0
      }
    }
  }
}
