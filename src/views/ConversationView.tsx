import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Drawer, Empty, Layout, Space, Spin, Tabs, Tooltip, Typography } from 'antd'
import { ProfileOutlined } from '@ant-design/icons'
import type { AgentStreamEvent, Conversation, Message, Project } from '@shared/types'
import { Composer } from '../components/Composer'
import { PreviewPane } from '../components/PreviewPane'
import { LayerTree } from '../components/LayerTree'
import { MessageBubble } from '../components/MessageBubble'
import { ThinkingBubble } from '../components/ThinkingBubble'

const { Content, Sider } = Layout

interface StreamPayload {
  conversationId: string
  event: AgentStreamEvent
}

type Ready = { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string }

interface Props {
  conversationId: string
  onConversationUpdated: () => void // 通知外层刷新侧栏(标题/时间)
}

export function ConversationView({ conversationId, onConversationUpdated }: Props): JSX.Element {
  const [conv, setConv] = useState<Conversation | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ id: string; prompt: string } | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [ready, setReady] = useState<Ready>({ state: 'idle' })
  const [logOpen, setLogOpen] = useState(false)
  const [logs, setLogs] = useState<{ ts: number; level: string; message: string }[]>([])
  const msgEndRef = useRef<HTMLDivElement>(null)

  // 载入对话 + 项目 + 消息
  useEffect(() => {
    let cancelled = false
    setReady({ state: 'idle' })
    window.api.convGet(conversationId).then(async (c) => {
      if (cancelled || !c) return
      setConv(c)
      const p = await window.api.projectGet(c.projectId)
      if (cancelled) return
      setProject(p)
      window.api.msgList(conversationId).then((m) => !cancelled && setMessages(m))
    })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // 就绪门控:确保 PS 打开对应设计稿
  const ensureReady = useCallback((psdPath: string) => {
    setReady({ state: 'loading' })
    window.api
      .psOpenDesign(psdPath)
      .then((res) =>
        setReady(res.ok ? { state: 'ok', message: res.message } : { state: 'error', message: res.message })
      )
      .catch((e) => setReady({ state: 'error', message: String(e) }))
  }, [])

  useEffect(() => {
    if (project) ensureReady(project.psdPath)
  }, [project, conversationId, ensureReady])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const appendMsg = (role: Message['role'], content: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), conversationId, role, content, createdAt: '' }
    ])
  }

  const handleEvent = (event: AgentStreamEvent): void => {
    switch (event.type) {
      case 'text':
        if (event.text.trim()) appendMsg('assistant', event.text)
        break
      case 'tool_use':
        appendMsg('tool', `→ 调用工具 ${event.name}`)
        if (event.name === 'export_groups') setExporting(true)
        break
      case 'tool_result':
        appendMsg('tool', event.text)
        if (event.name === 'export_groups') setExporting(false)
        setPreviewNonce((n) => n + 1)
        break
      case 'confirm':
        setConfirm({ id: event.id, prompt: event.prompt })
        break
      case 'result':
        setBusy(false)
        setExporting(false)
        setPreviewNonce((n) => n + 1)
        onConversationUpdated()
        break
      case 'error':
        appendMsg('assistant', `⚠ ${event.message}`)
        setBusy(false)
        setExporting(false)
        break
    }
  }

  useEffect(() => {
    const off = window.api.onAgentStream((raw) => {
      const { conversationId: cid, event } = raw as StreamPayload
      if (cid !== conversationId) return
      handleEvent(event)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const send = async (text: string): Promise<void> => {
    if (busy) return
    appendMsg('user', text)
    setBusy(true)
    await window.api.agentSend({ conversationId, text })
  }

  const answerConfirm = async (approved: boolean): Promise<void> => {
    if (!confirm) return
    await window.api.agentConfirm(confirm.id, approved)
    appendMsg('tool', approved ? '✓ 已确认' : '✗ 已取消')
    setConfirm(null)
  }

  const updateConv = (c: Conversation): void => {
    setConv(c)
    onConversationUpdated()
  }

  if (!conv || !project) return <Spin style={{ margin: 'auto' }} />

  const gateDisabled = ready.state !== 'ok'

  return (
    <Layout style={{ height: '100%', overflow: 'hidden' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="conv-toolbar">
          <Typography.Text className="title" title={conv.title}>
            {conv.title}
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Tooltip title="查看请求日志">
            <Button
              type="text"
              icon={<ProfileOutlined />}
              onClick={() => {
                window.api.agentLogs(conversationId).then(setLogs)
                setLogOpen(true)
              }}
            />
          </Tooltip>
        </div>

        <Drawer
          title="请求日志"
          placement="right"
          styles={{ wrapper: { width: 480 } }}
          open={logOpen}
          onClose={() => setLogOpen(false)}
          extra={
            <Button
              size="small"
              onClick={() => window.api.agentLogs(conversationId).then(setLogs)}
            >
              刷新
            </Button>
          }
        >
          {logs.length === 0 ? (
            <Empty description="暂无日志" />
          ) : (
            <div className="log-list">
              {logs.map((l, i) => (
                <div key={i} className={`log-item log-${l.level}`}>
                  <div className="log-meta">
                    <span className="log-level">{l.level}</span>
                    <span className="log-ts">{new Date(l.ts).toLocaleTimeString()}</span>
                  </div>
                  <pre className="log-msg">{l.message}</pre>
                </div>
              ))}
            </div>
          )}
        </Drawer>
        {ready.state === 'error' && (
          <div style={{ padding: '8px 16px 0' }}>
            <Alert
              type="error"
              showIcon
              title="Photoshop 未就绪"
              description={ready.message}
              action={
                <Button size="small" onClick={() => ensureReady(project.psdPath)}>
                  重试
                </Button>
              }
            />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: 16, minHeight: 0 }}>
          {messages.length === 0 && ready.state === 'ok' && (
            <Empty description="开始你的第一句指令吧" style={{ marginTop: 60 }} />
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {confirm && (
            <Alert
              type="warning"
              style={{ margin: '8px 0' }}
              title={confirm.prompt}
              action={
                <Space orientation="vertical">
                  <Button type="primary" size="small" onClick={() => answerConfirm(true)}>
                    确认
                  </Button>
                  <Button size="small" onClick={() => answerConfirm(false)}>
                    取消
                  </Button>
                </Space>
              }
            />
          )}
          {busy && <ThinkingBubble />}
          <div ref={msgEndRef} />
        </div>

        <Composer
          conversation={conv}
          busy={busy}
          disabled={gateDisabled}
          designName={project.name}
          readyState={ready.state}
          readyMessage={ready.message}
          onSend={send}
          onStop={() => {
            window.api.agentCancel(conversationId)
            setBusy(false)
            appendMsg('tool', '⏹ 已停止')
          }}
          onUpdate={updateConv}
        />
      </Content>

      <Sider width={420} theme="light" style={{ height: '100%', overflow: 'hidden', borderLeft: '1px solid var(--border)' }}>
        <Tabs
          className="right-tabs"
          defaultActiveKey="preview"
          items={[
            {
              key: 'preview',
              label: '导出预览',
              children: (
                <PreviewPane conversation={conv} nonce={previewNonce} exporting={exporting} />
              )
            },
            {
              key: 'layers',
              label: '图层结构',
              children: (
                <div style={{ padding: 12, height: '100%', overflow: 'auto' }}>
                  <LayerTree psdPath={project.psdPath} />
                </div>
              )
            }
          ]}
        />
      </Sider>
    </Layout>
  )
}
