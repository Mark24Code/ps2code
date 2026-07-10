import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { AgentStreamEvent } from '../../../shared/types'
import { getConversation, getProject, getSettings } from '../db'
import { readPsdMeta } from '../psd'
import { exportGroups, mutateLayers, renameGroups } from '../photoshop/operations'

type Emit = (event: AgentStreamEvent) => void

// 待用户确认的操作:id -> resolve
const pendingConfirms = new Map<string, (approved: boolean) => void>()

export function resolveConfirm(id: string, approved: boolean): void {
  const r = pendingConfirms.get(id)
  if (r) {
    pendingConfirms.set(id, () => {}) // 防重复
    pendingConfirms.delete(id)
    r(approved)
  }
}

// 破坏性操作前请求确认
function requestConfirm(emit: Emit, prompt: string, payload: unknown): Promise<boolean> {
  const id = randomUUID()
  return new Promise((resolve) => {
    pendingConfirms.set(id, resolve)
    emit({ type: 'confirm', id, prompt, payload })
  })
}

const abortMap = new Map<number, AbortController>()

export function cancelAgent(conversationId: number): void {
  abortMap.get(conversationId)?.abort()
  abortMap.delete(conversationId)
}

export async function runAgent(
  conversationId: number,
  userText: string,
  emit: Emit
): Promise<void> {
  const conv = getConversation(conversationId)
  if (!conv) {
    emit({ type: 'error', message: '对话不存在' })
    return
  }
  const project = getProject(conv.projectId)
  if (!project) {
    emit({ type: 'error', message: '项目不存在' })
    return
  }
  const settings = getSettings()
  if (!settings.apiKey) {
    emit({ type: 'error', message: '未配置 API 密钥,请在设置中填写。' })
    return
  }

  const targetPath = project.psdPath

  // 图层树摘要作为上下文
  let layerSummary = ''
  try {
    const meta = await readPsdMeta(targetPath)
    const names: string[] = []
    const walk = (nodes: typeof meta.tree): void => {
      for (const n of nodes) {
        if (n.kind === 'group') names.push(n.name)
        if (n.children) walk(n.children)
      }
    }
    walk(meta.tree)
    layerSummary = `设计稿尺寸 ${meta.width}x${meta.height},共 ${meta.groupCount} 个图层组。组名示例(最多50个):\n${names.slice(0, 50).join(', ')}`
  } catch (e) {
    layerSummary = `(读取图层树失败: ${(e as Error).message})`
  }

  // 本地工具
  const server = createSdkMcpServer({
    name: 'ps2code',
    version: '1.0.0',
    tools: [
      tool(
        'list_layers',
        '读取并返回当前设计稿的图层组结构,可用正则过滤组名',
        { pattern: z.string().optional().describe('可选,用于过滤组名的正则表达式') },
        async (args) => {
          const meta = await readPsdMeta(targetPath)
          const names: string[] = []
          const walk = (nodes: typeof meta.tree): void => {
            for (const n of nodes) {
              if (n.kind === 'group') {
                if (!args.pattern || new RegExp(args.pattern).test(n.name)) names.push(n.name)
              }
              if (n.children) walk(n.children)
            }
          }
          walk(meta.tree)
          emit({ type: 'tool_result', name: 'list_layers', text: `匹配 ${names.length} 个组` })
          return { content: [{ type: 'text', text: JSON.stringify({ groups: names }) }] }
        }
      ),
      tool(
        'rename_groups',
        '批量重命名图层组,规则为 from->to 列表',
        {
          rules: z
            .array(z.object({ from: z.string(), to: z.string() }))
            .describe('重命名规则数组')
        },
        async (args) => {
          const res = await renameGroups(targetPath, args.rules)
          emit({ type: 'tool_result', name: 'rename_groups', text: res.log.join('\n') })
          return {
            content: [{ type: 'text', text: JSON.stringify(res.data) }],
            isError: !res.ok
          }
        }
      ),
      tool(
        'mutate_layers',
        '修改图层:显示/隐藏/删除图层组(删除为破坏性操作,会先请求用户确认)',
        {
          ops: z
            .array(
              z.object({
                action: z.enum(['hide', 'show', 'delete']),
                name: z.string()
              })
            )
            .describe('操作列表')
        },
        async (args) => {
          const hasDestructive = args.ops.some((o) => o.action === 'delete')
          if (hasDestructive) {
            const approved = await requestConfirm(
              emit,
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
          return {
            content: [{ type: 'text', text: JSON.stringify(res.data) }],
            isError: !res.ok
          }
        }
      ),
      tool(
        'export_groups',
        '导出匹配的图层组为 PNG 到本对话临时目录用于预览。倍率与裁剪默认取对话设置。',
        {
          pattern: z.string().optional().describe('匹配组名的正则'),
          names: z.array(z.string()).optional().describe('明确的组名列表')
        },
        async (args) => {
          const cur = getConversation(conversationId)!
          const res = await exportGroups({
            targetPath,
            pattern: args.pattern ?? '',
            names: args.names ?? [],
            x1: cur.opt1x,
            x2: cur.opt2x,
            trim: cur.optTrim,
            outputDir: cur.tmpDir
          })
          emit({ type: 'tool_result', name: 'export_groups', text: res.log.join('\n') })
          return {
            content: [{ type: 'text', text: JSON.stringify(res.data) }],
            isError: !res.ok
          }
        }
      )
    ]
  })

  const systemPrompt = `你是 PS2Code 的设计稿助手。用户已锁定设计稿: ${targetPath}。
你的职责是理解用户意图,并调用本地工具完成图层的查询/重命名/增删改/导出。
不要臆造图层名;不确定时先用 list_layers 查询。破坏性操作(删除)会由系统弹出确认。
当前设计稿信息:\n${layerSummary}`

  const abort = new AbortController()
  abortMap.set(conversationId, abort)

  try {
    for await (const message of query({
      prompt: userText,
      options: {
        model: settings.apiModel || 'claude-sonnet-4-5',
        systemPrompt,
        mcpServers: { ps2code: server },
        allowedTools: ['mcp__ps2code__*'],
        maxTurns: 20,
        abortController: abort,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: settings.apiKey,
          ...(settings.apiBaseUrl ? { ANTHROPIC_BASE_URL: settings.apiBaseUrl } : {})
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as AsyncIterable<any>) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') emit({ type: 'text', text: block.text })
          else if (block.type === 'tool_use')
            emit({ type: 'tool_use', name: block.name, input: block.input })
        }
      } else if (message.type === 'result') {
        emit({ type: 'result', text: message.result ?? '' })
      }
    }
  } catch (e) {
    emit({ type: 'error', message: (e as Error).message })
  } finally {
    abortMap.delete(conversationId)
  }
}
