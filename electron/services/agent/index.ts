import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { AgentStreamEvent } from '../../../shared/types'
import { resolveApiConfig, buildAgentEnv } from '../../../shared/apiConfig'
import { addLog } from './logStore'
import { getConversation, getProject, getSettings } from '../db'
import { readPsdMeta } from '../psd'
import { createToolHandlers } from './agentTools'

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

const abortMap = new Map<string, AbortController>()

export function cancelAgent(conversationId: string): void {
  abortMap.get(conversationId)?.abort()
  abortMap.delete(conversationId)
}

export async function runAgent(
  conversationId: string,
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
  // 设置优先,未配置时回退系统环境变量(ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL)
  const apiConfig = resolveApiConfig(settings)
  if (!apiConfig.authToken) {
    emit({
      type: 'error',
      message:
        '未配置 API 密钥。请在设置中填写,或设置系统环境变量 ANTHROPIC_AUTH_TOKEN(可选 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL)。'
    })
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

  // 本地工具:复用抽出的 agentTools handler(与测试同源)
  const handlers = createToolHandlers({
    targetPath,
    conversationId,
    emit,
    requestConfirm: (prompt, payload) => requestConfirm(emit, prompt, payload)
  })
  const server = createSdkMcpServer({
    name: 'ps2code',
    version: '1.0.0',
    tools: [
      tool(
        'list_layers',
        '读取并返回当前设计稿的完整图层组层级树(含 id/name/kind/hidden/children)。可用正则过滤组名(不传则返回全部)。',
        { pattern: z.string().optional().describe('可选,用于过滤组名的正则表达式,不传则返回完整树') },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args) => handlers.listLayers(args) as any
      ),
      tool(
        'rename_groups',
        '批量重命名图层组,规则为 from->to 列表',
        { rules: z.array(z.object({ from: z.string(), to: z.string() })).describe('重命名规则数组') },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args) => handlers.renameGroups(args) as any
      ),
      tool(
        'mutate_layers',
        '修改图层:显示/隐藏/删除图层组(删除为破坏性操作,会先请求用户确认)',
        {
          ops: z
            .array(z.object({ action: z.enum(['hide', 'show', 'delete']), name: z.string() }))
            .describe('操作列表')
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args) => handlers.mutateLayers(args) as any
      ),
      tool(
        'export_groups',
        '导出匹配的图层组为 PNG 到本对话临时目录用于预览。倍率与裁剪默认取对话设置。支持 parent 参数限定在指定父组下搜索。',
        {
          pattern: z.string().optional().describe('匹配组名的正则'),
          names: z.array(z.string()).optional().describe('明确的组名列表'),
          parent: z.string().optional().describe('限定搜索范围:只在指定父组名下的子组中查找(不同父组下有同名字组时用于区分)')
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args) => handlers.exportGroups(args) as any
      )
    ]
  })

  const systemPrompt = `你是 PS2Code 的设计稿助手。用户已锁定设计稿: ${targetPath}。
你的职责是理解用户意图,并调用本地工具完成图层的查询/重命名/增删改/图层导出图片。
不要臆造图层名;不确定时先用 list_layers 查看完整层级树。
图层名字可能会出现重复(例如"x默认"和"已签"下都有1~7)，可以用 export_groups 的 parent 参数指定父组来区分范围。

【导出前确认流程】
导出图片前，必须先用 list_layers 搜索定位目标图层，把完整路径、bounds坐标、尺寸整理后，向用户列出即将导出的图层清单并请求确认。用户确认后才能调用 export_groups 执行导出。

【导出文件命名规则】
导出的文件名以图层树中最末位(叶子)图层/组的名字为准。如果导出了多个同名的组，文件会自动添加 _01,_02 等后缀。

【防覆盖】
每次导出前，先检查输出目录中是否已存在同名 .png(或 @2x.png) 文件。如果已有，自动跳过已存在的序号，分配下一个可用序号，确保绝不覆盖已有文件。

破坏性操作(删除)会由系统弹出确认。
当前设计稿信息:\n${layerSummary}`

  const abort = new AbortController()
  abortMap.set(conversationId, abort)

  addLog(
    conversationId,
    'request',
    `发送请求 · 模型 ${apiConfig.model}${apiConfig.baseUrl ? ` · 地址 ${apiConfig.baseUrl}` : ' · 官方端点'}\n用户: ${userText}`
  )
  // 记录发给 Agent SDK 的完整上下文(system prompt + 图层摘要),便于排查
  addLog(
    conversationId,
    'context',
    `发送给 Agent SDK 的上下文:\n[systemPrompt]\n${systemPrompt}\n[allowedTools] mcp__ps2code__*\n[prompt] ${userText}`
  )

  try {
    for await (const message of query({
      prompt: userText,
      options: {
        model: apiConfig.model,
        systemPrompt,
        mcpServers: { ps2code: server },
        allowedTools: ['mcp__ps2code__*'],
        maxTurns: 20,
        abortController: abort,
        // Electron 主进程里没有独立 node 可执行文件:用 Electron 自身二进制,
        // 并通过 ELECTRON_RUN_AS_NODE=1 让子进程以纯 Node 模式运行 SDK 的 CLI,
        // 否则 spawn 出的进程无法启动 → 一直卡在"思考中"。
        executable: process.execPath as 'node',
        env: { ...buildAgentEnv(apiConfig), ELECTRON_RUN_AS_NODE: '1' }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as AsyncIterable<any>) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            emit({ type: 'text', text: block.text })
            addLog(conversationId, 'response', `助手: ${block.text}`)
          } else if (block.type === 'tool_use') {
            emit({ type: 'tool_use', name: block.name, input: block.input })
            addLog(
              conversationId,
              'tool',
              `调用工具 ${block.name}\n参数: ${JSON.stringify(block.input)}`
            )
          }
        }
      } else if (message.type === 'result') {
        emit({ type: 'result', text: message.result ?? '' })
        addLog(conversationId, 'response', `完成 · result: ${message.result ?? ''}`)
      }
    }
  } catch (e) {
    emit({ type: 'error', message: (e as Error).message })
    addLog(conversationId, 'error', `错误: ${(e as Error).message}`)
  } finally {
    abortMap.delete(conversationId)
  }
}

// 检查 Agent 配置能否正常工作:用当前(或草稿)配置发一个最小请求。
// draft 传入设置页未保存的值;不传则用已保存的 settings。
export async function checkAgentConfig(draft?: {
  apiBaseUrl?: string
  apiKey?: string
  apiModel?: string
}): Promise<{ ok: boolean; message: string }> {
  const settings = draft ?? getSettings()
  const cfg = resolveApiConfig(settings)
  if (!cfg.authToken) {
    return { ok: false, message: '缺少 API 密钥(设置或环境变量 ANTHROPIC_AUTH_TOKEN)' }
  }
  // 直连 Anthropic 兼容端点做连通性校验(比走 SDK 子进程更直接、能真实反映配置)。
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const url = `${base}/v1/messages`
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 20000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        // 兼容两种鉴权:官方 x-api-key 与代理常用的 Bearer
        'x-api-key': cfg.authToken,
        authorization: `Bearer ${cfg.authToken}`
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hello' }]
      })
    })

    // 只要 HTTP 200 即认为配置可用
    if (res.ok) {
      return { ok: true, message: `连接正常(模型 ${cfg.model})` }
    }
    const text = await res.text().catch(() => '')
    let detail = text.slice(0, 200)
    try {
      detail = JSON.parse(text)?.error?.message ?? detail
    } catch {
      /* 保留原始文本 */
    }
    return { ok: false, message: `连接失败:HTTP ${res.status} ${detail}` }
  } catch (e) {
    const err = e as Error
    const msg = err.name === 'AbortError' ? '请求超时(20s)' : err.message
    return { ok: false, message: `连接失败:${msg}` }
  } finally {
    clearTimeout(timer)
  }
}
