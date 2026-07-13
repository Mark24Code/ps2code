import type { AgentStreamEvent } from '../../../shared/types'
import { getConversation } from '../db'
import { readPsdMeta } from '../psd'
import type { PsdLayerNode } from '../../../shared/types'
import {
  exportGroups,
  mutateLayers,
  renameGroups,
  type RenameRule,
  type LayerOp
} from '../photoshop/operations'

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
    async listLayers(args: { pattern?: string }): Promise<ToolResult> {
      const meta = await readPsdMeta(targetPath)
      // 返回完整层级树（含 id、name、kind、hidden、children），
      // 让 AI 能理解图层层级关系，通过 parent 参数精确定位导出范围
      const simplifyTree = (nodes: PsdLayerNode[]): unknown[] => {
        return nodes.map(n => {
          const node: Record<string, unknown> = {
            id: n.id,
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

    async exportGroups(args: { pattern?: string; names?: string[]; parent?: string }): Promise<ToolResult> {
      const cur = getConversation(conversationId)!
      const res = await exportGroups({
        targetPath,
        pattern: args.pattern ?? '',
        names: args.names ?? [],
        parent: args.parent,
        x1: cur.opt1x,
        x2: cur.opt2x,
        trim: cur.optTrim,
        outputDir: cur.tmpDir
      })
      emit({ type: 'tool_result', name: 'export_groups', text: res.log.join('\n') })
      // 把日志细节也注入到返回数据中,方便 Agent 定位失败原因
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...res.data, _log: res.log }) }],
        isError: !res.ok || res.data.err > 0
      }
    }
  }
}
