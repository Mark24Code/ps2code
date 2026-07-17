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
      name: 'search_layers',
      label: '搜索图层',
      description:
        '按用户意图搜索图层。把自然语言意图转成标准匹配:mode=fuzzy 子串模糊(默认)、mode=regex 正则;parent 先定位父节点再只在其子树内搜索。返回命中列表,每条含 path(图层名链路径)、psId(PSD 原生 id,导出定位用)、id、name、kind、hidden、bounds。导出前必须先用本工具定位并收集 psId。',
      parameters: Type.Object({
        query: Type.String({ description: '匹配关键字(fuzzy 为子串;regex 为正则表达式)' }),
        mode: Type.Optional(
          Type.Union([Type.Literal('fuzzy'), Type.Literal('regex')], {
            description: '匹配方式:fuzzy(子串,默认)或 regex(正则)'
          })
        ),
        parent: Type.Optional(
          Type.String({ description: '可选父节点名:先匹配该父节点,再只在其子树内搜索' })
        )
      }),
      execute: async (_id, params) => wrap(await handlers.searchLayers(params))
    }),
    defineTool({
      name: 'list_layers',
      label: '列出图层',
      description:
        '读取并返回当前设计稿的完整图层层级树(含 id/psId/path/name/kind/hidden/children)。用于通览结构;精确定位请优先用 search_layers。',
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
      description:
        '批量重命名图层组,规则为 from->to 列表。这是对设计稿的改动,必须先取得用户明确同意才能调用;严禁在导出流程中为区分文件而擅自改名(导出用 “叶子名_id” 已保证唯一)。',
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
        '修改图层可见性/删除:显示(show)/隐藏(hide)/删除(delete)。适用于任意图层(普通图层与图层组均可)。' +
        '定位优先用 psId(来自 search_layers,精确);缺省则按 name 匹配所有同名图层。删除为破坏性操作,会先请求用户确认。',
      parameters: Type.Object({
        ops: Type.Array(
          Type.Object({
            action: Type.Union([
              Type.Literal('hide'),
              Type.Literal('show'),
              Type.Literal('delete')
            ]),
            psId: Type.Optional(Type.Number({ description: 'PSD 原生图层 id(精确定位,优先)' })),
            name: Type.Optional(Type.String({ description: '图层名(psId 缺失时按名匹配所有同名图层)' }))
          }),
          { description: '操作列表' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.mutateLayers(params))
    }),
    defineTool({
      name: 'set_text',
      label: '修改文字',
      description:
        '修改文字图层的文字内容。目标必须是文字图层。定位优先用 psId(来自 search_layers,精确);缺省则按 name 匹配第一个同名图层。' +
        '这是对设计稿的改动,必须先取得用户明确同意才能调用。',
      parameters: Type.Object({
        edits: Type.Array(
          Type.Object({
            psId: Type.Optional(Type.Number({ description: 'PSD 原生图层 id(精确定位,优先)' })),
            name: Type.Optional(Type.String({ description: '文字图层名(psId 缺失时按名定位)' })),
            text: Type.String({ description: '要写入的新文字内容' })
          }),
          { description: '文字修改列表' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.setText(params))
    }),
    defineTool({
      name: 'merge_groups',
      label: '合并图层组',
      description:
        '把图层组合并(压平)为单个普通图层。不可逆(组内结构丢失)且会保存文件,调用前系统会请求用户确认。' +
        '定位优先用 psId(来自 search_layers,精确);缺省则按 name 匹配第一个同名组。',
      parameters: Type.Object({
        targets: Type.Array(
          Type.Object({
            psId: Type.Optional(Type.Number({ description: 'PSD 原生图层 id(精确定位,优先)' })),
            name: Type.Optional(Type.String({ description: '图层组名(psId 缺失时按名定位)' }))
          }),
          { description: '要合并的图层组列表' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.mergeGroups(params))
    }),
    defineTool({
      name: 'export_groups',
      label: '导出图层',
      description:
        '导出图层为 PNG 到本对话临时目录用于预览。倍率与裁剪默认取对话设置。' +
        '优先传 targets(来自 search_layers 的命中,含 psId 用于精确定位、path/id/name 用于命名);' +
        '文件名规则为 “末端叶子图层名_节点id”。也兼容旧的 pattern/names/parent(会在内部转为 targets)。',
      parameters: Type.Object({
        targets: Type.Optional(
          Type.Array(
            Type.Object({
              psId: Type.Optional(Type.Number({ description: 'PSD 原生图层 id(定位用)' })),
              path: Type.String({ description: '图层名链路径,如 根组/x默认/1' }),
              id: Type.String({ description: '路径式 id,如 0/2/1(psId 缺失时的回退)' }),
              name: Type.String({ description: '末端叶子图层/组名(命名用)' })
            }),
            { description: 'search_layers 命中的导出目标列表(推荐)' }
          )
        ),
        pattern: Type.Optional(Type.String({ description: '(兼容)匹配组名的正则' })),
        names: Type.Optional(Type.Array(Type.String(), { description: '(兼容)明确的组名列表' })),
        parent: Type.Optional(
          Type.String({ description: '(兼容)限定父组范围' })
        )
      }),
      execute: async (_id, params) => wrap(await handlers.exportGroups(params))
    }),
    defineTool({
      name: 'export_selection',
      label: '按选区导出图层',
      description:
        '导出用户在 Photoshop 中当前选区范围内的目标图层为 PNG。用户需先在 Photoshop 中用选区工具(矩形选框/套索/魔棒等)框选要导出的区域,然后调用此工具。' +
        '会读取 PS 中的激活选区,只导出选区内的内容。优先传 targets(来自 search_layers 的命中,含 psId/path/id/name)。' +
        '注意:选区必须在 Photoshop 中保持激活状态;如果选区已取消,请让用户重新框选。',
      parameters: Type.Object({
        targets: Type.Array(
          Type.Object({
            psId: Type.Optional(Type.Number({ description: 'PSD 原生图层 id(定位用)' })),
            path: Type.String({ description: '图层名链路径,如 根组/x默认/1' }),
            id: Type.String({ description: '路径式 id,如 0/2/1(psId 缺失时的回退)' }),
            name: Type.String({ description: '末端叶子图层/组名(命名用)' })
          }),
          { description: 'search_layers 命中的导出目标列表' }
        )
      }),
      execute: async (_id, params) => wrap(await handlers.exportSelection(params))
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
  // 从 auth.json 读取 apiKey(不再从 config.json 读取)
  let authKey = ''
  try {
    const { readFileSync, existsSync } = await import('fs')
    if (existsSync(authFilePath())) {
      const authData = JSON.parse(readFileSync(authFilePath(), 'utf8'))
      const authProvider = settings.apiProvider || 'deepseek'
      authKey = authData?.apiKeys?.[authProvider] || ''
    }
  } catch { /* auth.json 可能还不存在 */ }
  const apiConfig = resolveApiConfig({ ...settings, apiKey: authKey })
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
你的职责是理解用户意图,并调用本地工具完成图层的查询/搜索/重命名/增删改/导出图片。
不要臆造图层名;不确定时先用 list_layers 通览结构,或用 search_layers 精确定位。

【先思考,用最短步骤完成】
动手前先想清楚目标,选最短路径完成,别过度纠结、别反复确认。产物是可编辑、可再选择的,不必追求一次绝对完美。

【搜索:先把用户意图转成标准匹配】
当用户提出搜索/定位需求时,你要理解意图并转换成 search_layers 的标准参数再计算:
- 模糊搜索(mode=fuzzy,默认):按子串、大小写不敏感。适合"包含""大概叫""带 xx 字样"等模糊描述。
- 正则搜索(mode=regex):把意图翻译成正则,如"1到7的图层"→ query="^[1-7]$"、"以 btn 开头"→ query="^btn"。
- 父范围(parent):当同名图层出现在不同父组下(例如"x默认"和"已签"下都有 1~7),用 parent 先定位父节点,再只在其子树内搜索。
search_layers 会返回每个命中的 path(图层名链路径)与 psId(PSD 原生 id)。你必须把这些命中收集起来用于后续导出。

【先判断意图:导出 还是 改稿(决定要不要征求同意)】
动手前先分清用户到底想要什么,这决定了操作是否需要征得同意:
- 「只是想要图片」= 导出意图:用户要的是最终图片产物,不关心设计稿本身是否改变。
  标准做法是「不碰原稿」——把相关目标图层复制到临时图层(副本)上,再在副本上做必要的加工(如修改文字、合并图层、隐藏某些元素以得到干净的导出结果),然后导出这些副本。
  这些都是在临时副本上的操作,属于导出流程的一部分,不改动用户的原始设计稿,因此无需征求用户同意,直接高效完成即可。
- 「要改这个设计稿」= 改稿意图:用户明确想让原始 PSD 文件本身发生持久变化(例如“把标题文字改成 X 并保存”“把这个组删掉”“合并这两个组”)。
  这类操作会写回并保存原稿,是破坏性/持久的,必须先向用户说明并取得同意后才执行(见下方【修改类操作需用户同意】)。
判断不清时,优先按“导出意图 + 在副本上加工”处理,避免擅自改动用户原稿;必要时用一句话向用户确认意图。

【导出流程:能直接导就直接导】
先用 search_layers 定位目标。
- 命中数量 < 20 张:直接调 export_groups 导出到临时预览区,不用先列清单等确认——产物会显示在预览面板,用户可自行编辑、勾选、再正式导出。这是默认的高效路径。
- 命中数量 ≥ 20 张(或范围明显过宽/意图不明确):先把清单(path、psId、尺寸)简要列给用户确认,避免误导出一大批。
把命中项作为 export_groups 的 targets 传入(带上 psId/path/id/name)。

【导出时严禁擅自改名】
导出过程中绝对不要为了"区分文件"而去重命名图层(不要调用 rename_groups)。
文件名唯一性由系统保证——无需你改图层名。修改图层名属于对设计稿的改动,必须单独、显式地征得用户同意后才能做,绝不能作为导出的附带步骤。

【导出文件命名规则(默认高效方式)】
导出的默认且唯一高效方式:文件名 = “末端叶子图层名_节点id”(节点id 优先用 PSD 原生 psId,缺失时回退路径式 id)。
“叶子名_id” 天然不重复,因此即使多个图层同名也能直接、无冲突地导出,无需先改名再导出。
注意文件名中不能出现路径分隔符 “/”,遇到会自动替换为 “_”(如 A/B/C → A_B_C)。同名文件系统还会自动追加 _01/_02 序号兜底。
用户确认导出到目标目录后,系统会额外生成 layout.json,记录每张图的原始 psId、坐标、尺寸、文件名与 z-index(顶层在上者更大),可据此还原布局,无需你手工整理这些数据。

【修改类操作需用户同意——仅当改动的是原始设计稿时】
判断标准是「改的是原稿,还是导出用的临时副本」:
- 改动会写回并保存到原始 PSD:重命名(rename_groups)、显示/隐藏/删除(mutate_layers)、修改文字(set_text)、合并图层组(merge_groups)作用在原稿上时,都必须先向用户说明并取得同意后才执行,不得擅自进行。删除与合并还会由系统再弹一次确认。
- 为了导出而在临时副本上做的同类加工(改文字、合并、隐藏元素等),是导出流程的一部分,不改动原稿,无需征求同意,直接做。
修改文字用 set_text(目标须为文字图层);合并图层组用 merge_groups(压平为单个图层,不可逆)。定位这些目标时优先用 search_layers 拿到的 psId,更精确。
当前设计稿信息:\n${layerSummary}

【按选区导出:export_selection】
用户可能在 Photoshop 中手工框选了某个区域(矩形选框/套索等),然后说"导出这部分的某某图层"。
此时使用 export_selection,其他规则(传 targets、命名、倍率等)与 export_groups 完全一致。
关键区别:export_selection 会读取 PS 中当前激活的选区,只导出选区范围内的图层内容。
使用前务必让用户确认 PS 中选区是激活状态。如果用户说"选区已经取消了/不再需要了",则用普通的 export_groups 导出全幅。`

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
  // draft 没传 apiKey 时从 auth.json 读取
  let keyForCheck = draft?.apiKey ?? ''
  if (!keyForCheck) {
    try {
      const { readFileSync, existsSync } = await import('fs')
      if (existsSync(authFilePath())) {
        const authData = JSON.parse(readFileSync(authFilePath(), 'utf8'))
        const provider = settings.apiProvider || 'deepseek'
        keyForCheck = authData?.apiKeys?.[provider] || ''
      }
    } catch { /* */ }
  }
  const cfg = resolveApiConfig({ ...settings, apiKey: keyForCheck })
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
