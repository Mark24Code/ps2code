import { join } from 'path'
import { randomUUID } from 'crypto'
import { Type } from 'typebox'
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  defineTool,
  createAgentSession,
  type AgentSession,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { AgentStreamEvent } from '../../../shared/types'
import { resolveApiConfig, providerCheckEndpoint } from '../../../shared/apiConfig'
import { agentDirPath, authFilePath } from '../config'
import { addLog } from './logStore'
import { sessionDir } from './logStore'
import { getConversation, getProject, getSettings } from '../db'
import { readPsdMeta } from '../psd'
import { createToolHandlers, type ToolResult } from './agentTools'

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

// 进行中的 pi 会话:conversationId -> AgentSession(用于取消)
const activeSessions = new Map<string, AgentSession>()

export function cancelAgent(conversationId: string): void {
  const session = activeSessions.get(conversationId)
  if (session) void session.abort()
}

// 把 agentTools 的 handler 包成 pi 的 ToolDefinition。
// pi 工具用 typebox 定义参数;失败通过 content 里的 JSON(含 ok/err/_log)反馈给模型,
// 与旧实现语义一致(不 throw,便于 Agent 自行排查并重试)。
function buildTools(handlers: ReturnType<typeof createToolHandlers>): ToolDefinition[] {
  const wrap = (r: ToolResult) => ({ content: r.content, details: {} })

  return [
    defineTool({
      name: 'list_layers',
      label: '列出图层',
      description:
        '读取并返回当前设计稿的完整图层组层级树(含 id/name/kind/hidden/children)。可用正则过滤组名(不传则返回全部)。',
      parameters: Type.Object({
        pattern: Type.Optional(
          Type.String({ description: '可选,用于过滤组名的正则表达式,不传则返回完整树' })
        )
      }),
      execute: async (_id, params) => wrap(await handlers.listLayers(params))
    }),
    defineTool({
      name: 'rename_groups',
      label: '重命名图层组',
      description: '批量重命名图层组,规则为 from->to 列表',
      parameters: Type.Object({
        rules: Type.Array(
          Type.Object({ from: Type.String(), to: Type.String() }),
          { description: '重命名规则数组' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.renameGroups(params))
    }),
    defineTool({
      name: 'mutate_layers',
      label: '修改图层',
      description:
        '修改图层:显示/隐藏/删除图层组(删除为破坏性操作,会先请求用户确认)',
      parameters: Type.Object({
        ops: Type.Array(
          Type.Object({
            action: Type.Union([
              Type.Literal('hide'),
              Type.Literal('show'),
              Type.Literal('delete')
            ]),
            name: Type.String()
          }),
          { description: '操作列表' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.mutateLayers(params))
    }),
    defineTool({
      name: 'export_groups',
      label: '导出图层组',
      description:
        '导出匹配的图层组为 PNG 到本对话临时目录用于预览。倍率与裁剪默认取对话设置。支持 parent 参数限定在指定父组下搜索。',
      parameters: Type.Object({
        pattern: Type.Optional(Type.String({ description: '匹配组名的正则' })),
        names: Type.Optional(Type.Array(Type.String(), { description: '明确的组名列表' })),
        parent: Type.Optional(
          Type.String({
            description:
              '限定搜索范围:只在指定父组名下的子组中查找(不同父组下有同名子组时用于区分)'
          })
        )
      }),
      execute: async (_id, params) => wrap(await handlers.exportGroups(params))
    })
  ]
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
  const apiConfig = resolveApiConfig(settings)
  if (!apiConfig.apiKey) {
    emit({
      type: 'error',
      message:
        '未配置 API 密钥。请在设置中填写 DeepSeek(或其它 provider)的 API Key,或设置对应的系统环境变量(如 DEEPSEEK_API_KEY)。'
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
  const customTools = buildTools(handlers)
  const toolNames = customTools.map((t) => t.name)

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

  addLog(
    conversationId,
    'request',
    `发送请求 · provider ${apiConfig.provider} · 模型 ${apiConfig.model}\n用户: ${userText}`
  )
  addLog(
    conversationId,
    'context',
    `发送给 pi-agent 的上下文:\n[systemPrompt]\n${systemPrompt}\n[tools] ${toolNames.join(', ')}\n[prompt] ${userText}`
  )

  let session: AgentSession | undefined
  try {
    // pi-agent 一切配置读自应用目录 ~/.ps2code(独立应用,不用默认 ~/.pi/agent)。
    const agentDir = agentDirPath()
    const authStorage = AuthStorage.create(authFilePath())
    // 用 app 设置里的密钥做运行时覆盖(不强制落盘 auth.json;若 auth.json 已存,pi 也会读)。
    authStorage.setRuntimeApiKey(apiConfig.provider, apiConfig.apiKey)
    const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'))

    // 用 registry 按 provider/id 查找模型(含内置模型,接受任意 provider 字符串)。
    const model = modelRegistry.find(apiConfig.provider, apiConfig.model)
    if (!model) {
      emit({
        type: 'error',
        message: `未找到模型 ${apiConfig.provider}/${apiConfig.model}。请检查设置里的 provider 与模型名。`
      })
      return
    }

    // 系统提示词通过 ResourceLoader 覆盖注入(含图层摘要)。
    const resourceLoader = new DefaultResourceLoader({
      cwd: agentDir,
      agentDir,
      systemPromptOverride: () => systemPrompt
    })
    await resourceLoader.reload()

    // 会话持久化:每对话一个目录 ~/.ps2code/sessions/<id>/,pi 在其中管理 .jsonl。
    // continueRecent:该目录已有会话则自动续接(加载完整历史),否则新建。
    const convSessionDir = join(sessionDir(conversationId), 'agent')
    const sessionManager = SessionManager.continueRecent(agentDir, convSessionDir)

    const created = await createAgentSession({
      cwd: agentDir,
      agentDir,
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager: SettingsManager.inMemory(),
      // 只启用我们的自定义工具,禁用 read/bash/edit/write 等内置工具。
      tools: toolNames,
      customTools
    })
    session = created.session
    activeSessions.set(conversationId, session)

    // 事件映射:pi 事件 → 现有 AgentStreamEvent(渲染层零改动)。
    // tool_result 事件仍由 agentTools 的 handler 内部发出。
    session.subscribe((event) => {
      if (event.type === 'turn_end') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = (event.message as any)?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              emit({ type: 'text', text: block.text })
              addLog(conversationId, 'response', `助手: ${block.text}`)
            } else if (block?.type === 'toolCall') {
              emit({ type: 'tool_use', name: block.name, input: block.arguments ?? block.args })
              addLog(
                conversationId,
                'tool',
                `调用工具 ${block.name}\n参数: ${JSON.stringify(block.arguments ?? block.args)}`
              )
            }
          }
        }
      } else if (event.type === 'agent_end') {
        emit({ type: 'result', text: '' })
        addLog(conversationId, 'response', '完成')
      }
    })

    await session.prompt(userText)
  } catch (e) {
    emit({ type: 'error', message: (e as Error).message })
    addLog(conversationId, 'error', `错误: ${(e as Error).message}`)
  } finally {
    activeSessions.delete(conversationId)
    session?.dispose()
  }
}

// 检查 Agent 配置能否正常工作:用当前(或草稿)配置对 provider 端点做连通性校验。
// draft 传入设置页未保存的值;不传则用已保存的 settings。
export async function checkAgentConfig(draft?: {
  apiProvider?: string
  apiKey?: string
  apiModel?: string
}): Promise<{ ok: boolean; message: string }> {
  const settings = draft ?? getSettings()
  const cfg = resolveApiConfig(settings)
  if (!cfg.apiKey) {
    return { ok: false, message: '缺少 API 密钥(在设置中填写,或设置对应环境变量)' }
  }
  const endpoint = providerCheckEndpoint(cfg.provider)
  if (!endpoint) {
    // 无内置校验端点的 provider:仅确认已填密钥,交由实际对话时报错。
    return { ok: true, message: `已配置 ${cfg.provider}/${cfg.model}(该 provider 无联网校验,发送对话时验证)` }
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 20000)
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: abort.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}` }
    })
    if (res.ok) {
      return { ok: true, message: `连接正常(${cfg.provider}/${cfg.model})` }
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
