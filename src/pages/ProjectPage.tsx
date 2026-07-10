import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Collapse,
  Empty,
  Layout,
  List,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { AgentStreamEvent, Conversation, Message, Project } from '@shared/types'
import { Composer } from '../components/Composer'
import { PreviewPane } from '../components/PreviewPane'
import { LayerTree } from '../components/LayerTree'
import { MessageBubble } from '../components/MessageBubble'

const { Sider, Content } = Layout

interface StreamPayload {
  conversationId: number
  event: AgentStreamEvent
}

type Ready = { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string }

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams()
  const { modal } = App.useApp()
  const pid = Number(projectId)
  const [project, setProject] = useState<Project | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ id: string; prompt: string } | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [ready, setReady] = useState<Ready>({ state: 'idle' })
  const msgEndRef = useRef<HTMLDivElement>(null)

  const loadConvs = useCallback(async (): Promise<Conversation[]> => {
    const list = await window.api.convList(pid)
    setConvs(list)
    return list
  }, [pid])

  useEffect(() => {
    window.api.projectGet(pid).then(setProject)
    loadConvs().then(async (list) => {
      if (list.length === 0) {
        const c = await window.api.convCreate(pid)
        setConvs([c])
        setActive(c)
      } else {
        setActive(list[0])
      }
    })
  }, [pid, loadConvs])

  useEffect(() => {
    if (active) window.api.msgList(active.id).then(setMessages)
  }, [active])

  // 进入/切换对话 → 调起 PS 打开对应设计稿,就绪后才允许对话
  useEffect(() => {
    if (!project || !active) return
    let cancelled = false
    setReady({ state: 'loading' })
    window.api
      .psOpenDesign(project.psdPath)
      .then((res) => {
        if (cancelled) return
        setReady(res.ok ? { state: 'ok', message: res.message } : { state: 'error', message: res.message })
      })
      .catch((e) => !cancelled && setReady({ state: 'error', message: String(e) }))
    return () => {
      cancelled = true
    }
    // 依赖 active.id:切换对话即使同一设计稿也重新确保就绪
  }, [project, active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const off = window.api.onAgentStream((raw) => {
      const { conversationId, event } = raw as StreamPayload
      if (!active || conversationId !== active.id) return
      handleEvent(event)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const appendMsg = (role: Message['role'], content: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), conversationId: active!.id, role, content, createdAt: '' }
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
        loadConvs()
        break
      case 'error':
        appendMsg('assistant', `⚠ ${event.message}`)
        setBusy(false)
        setExporting(false)
        break
    }
  }

  const send = async (text: string): Promise<void> => {
    if (!active || busy) return
    appendMsg('user', text)
    setBusy(true)
    await window.api.agentSend({ conversationId: active.id, text })
  }

  const answerConfirm = async (approved: boolean): Promise<void> => {
    if (!confirm) return
    await window.api.agentConfirm(confirm.id, approved)
    appendMsg('tool', approved ? '✓ 已确认' : '✗ 已取消')
    setConfirm(null)
  }

  const newConv = async (): Promise<void> => {
    const c = await window.api.convCreate(pid)
    await loadConvs()
    setActive(c)
  }

  const delConv = (id: number): void => {
    modal.confirm({
      title: '删除对话',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await window.api.convDelete(id)
        const list = await loadConvs()
        if (active?.id === id) setActive(list[0] ?? null)
      }
    })
  }

  const updateActive = (c: Conversation): void => {
    setActive(c)
    setConvs((prev) => prev.map((x) => (x.id === c.id ? c : x)))
  }

  const gateDisabled = ready.state !== 'ok'

  return (
    <Layout style={{ height: '100%' }}>
      {/* 左:对话列表 */}
      <Sider width={240} theme="light" style={{ borderRight: '1px solid var(--border)' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <Button type="primary" block icon={<PlusOutlined />} onClick={newConv}>
            新建对话
          </Button>
        </div>
        <List
          dataSource={convs}
          style={{ padding: 8 }}
          renderItem={(c) => (
            <List.Item
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                background: active?.id === c.id ? 'var(--brand-soft)' : 'transparent',
                border: 'none'
              }}
              onClick={() => setActive(c)}
              actions={[
                <Button
                  key="d"
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    delConv(c.id)
                  }}
                />
              ]}
            >
              <Typography.Text
                ellipsis
                style={{ color: active?.id === c.id ? 'var(--brand)' : undefined }}
              >
                {c.title}
              </Typography.Text>
            </List.Item>
          )}
        />
      </Sider>

      {/* 中:对话 */}
      <Content style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '10px 16px 0' }}>
          <Alert
            type={ready.state === 'error' ? 'error' : ready.state === 'ok' ? 'info' : 'warning'}
            showIcon
            message={
              <Space>
                <span>
                  设计稿:<b>{project?.name}</b>
                </span>
                {ready.state === 'loading' && <Tag icon={<Spin size="small" />}>正在打开 Photoshop…</Tag>}
                {ready.state === 'ok' && <Tag color="green">PS 就绪</Tag>}
                {ready.state === 'error' && <Tag color="red">未就绪</Tag>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  锁定,换设计稿请新建对话
                </Typography.Text>
              </Space>
            }
            description={ready.state === 'error' ? ready.message : undefined}
            action={
              ready.state === 'error' && project ? (
                <Button
                  size="small"
                  onClick={() => {
                    setReady({ state: 'loading' })
                    window.api
                      .psOpenDesign(project.psdPath)
                      .then((res) =>
                        setReady(res.ok ? { state: 'ok' } : { state: 'error', message: res.message })
                      )
                  }}
                >
                  重试
                </Button>
              ) : undefined
            }
          />
          {project && (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'tree',
                  label: '查看图层结构',
                  children: <LayerTree psdPath={project.psdPath} />
                }
              ]}
            />
          )}
        </div>

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
              message={confirm.prompt}
              action={
                <Space direction="vertical">
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
          {busy && <Spin style={{ display: 'block', marginTop: 8 }} tip="思考中…"><div /></Spin>}
          <div ref={msgEndRef} />
        </div>

        {active && (
          <Composer
            conversation={active}
            busy={busy}
            disabled={gateDisabled}
            onSend={send}
            onUpdate={updateActive}
          />
        )}
      </Content>

      {/* 右:预览 */}
      {active && (
        <Sider width={360} theme="light" style={{ height: '100%' }}>
          <PreviewPane conversation={active} nonce={previewNonce} exporting={exporting} />
        </Sider>
      )}
    </Layout>
  )
}
