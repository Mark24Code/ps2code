# Task 05 — 集成 claude-agent-sdk(意图→工具调度)

## 目标
主进程封装 Agent:接收用户自然语言 + 上下文(设计稿路径、图层树摘要、导出选项),解析意图并调用本地工具,流式回传消息到对话界面。Agent 只做意图解析与工具调度,不直接操作文件系统。

## SDK 用法(以安装后 node_modules 的 .d.ts 为准)
包名 `@anthropic-ai/claude-agent-sdk`。核心:`query()` + `tool()` + `createSdkMcpServer()`。

### 自定义 API 地址/密钥/模型
- `model` 走 `query()` 的 options。
- API 地址/密钥经 `options.env` 注入子进程环境(不污染主进程):
  ```ts
  env: { ...process.env, ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: baseUrl }
  ```
  三者从 settings 表读取(Task 09 设置页写入)。

### 进程内工具(in-process MCP)
```ts
const server = createSdkMcpServer({
  name: "ps2code",
  version: "1.0.0",
  tools: [
    tool("list_layers", "列出/搜索设计稿图层组", { pattern: z.string().optional() }, handler),
    tool("rename_groups", "批量重命名图层组", { rules: z.array(z.object({ from: z.string(), to: z.string() })) }, handler),
    tool("mutate_layers", "增删改图层/可见性", {...}, handler),
    tool("export_groups", "导出匹配的图层组为PNG", { pattern: z.string(), x1: z.boolean(), x2: z.boolean(), trim: z.boolean() }, handler),
  ],
});
// query({ prompt, options: { mcpServers: { ps2code: server }, allowedTools: ["mcp__ps2code__*"], model, env } })
```
- 各 handler 内部调用 Task 03(psd 解析)与 Task 04(PhotoshopBridge)。
- 工具返回 `{ content: [{ type: "text", text }] }`。

### 流式消息
`for await (const m of query(...))` 按 `m.type` 分发:
- `assistant`:遍历 `m.message.content`,`text` 块→对话气泡,`tool_use` 块→"正在调用工具"日志。
- `user`:tool_result → 工具执行结果日志。
- `result`:最终结论 + usage。
经 IPC/事件流(`webContents.send('agent:stream', ...)`)推给渲染进程。

## 交互确认
- 破坏性工具(删除图层、覆盖保存)先回传一个「待确认」事件,等渲染进程用户点确认再执行(对应 SPEC「Agent 和用户的交互确认」)。

## 验收
- 输入"把 组93 改名为 组193"→ Agent 调 `rename_groups` → PS 执行 → 回传成功日志。
- 自定义 base_url/model 生效。

## 依赖
- @anthropic-ai/claude-agent-sdk, zod
- 依赖 Task 04(PhotoshopBridge)、Task 03(psd 解析)
