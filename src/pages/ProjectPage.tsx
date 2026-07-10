import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type {
  AgentStreamEvent,
  Conversation,
  Message,
  Project
} from '@shared/types'
import { Composer } from '../components/Composer'
import { PreviewPane } from '../components/PreviewPane'
import { LayerTree } from '../components/LayerTree'

interface StreamPayload {
  conversationId: number
  event: AgentStreamEvent
}

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams()
  const pid = Number(projectId)
  const [project, setProject] = useState<Project | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ id: string; prompt: string } | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [showTree, setShowTree] = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)

  const loadConvs = useCallback(async (): Promise<Conversation[]> => {
    const list = await window.api.convList(pid)
    setConvs(list)
    return list
  }, [pid])

  // 初始化:项目 + 对话列表(空则建一条)
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

  // 切换对话 → 载入消息
  useEffect(() => {
    if (active) window.api.msgList(active.id).then(setMessages)
  }, [active])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 订阅 Agent 流
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
        break
      case 'tool_result':
        appendMsg('tool', event.text)
        // 工具可能产出预览图,刷新预览
        setPreviewNonce((n) => n + 1)
        break
      case 'confirm':
        setConfirm({ id: event.id, prompt: event.prompt })
        break
      case 'result':
        setBusy(false)
        setPreviewNonce((n) => n + 1)
        loadConvs() // 刷新对话标题(首条消息后自动命名)
        break
      case 'error':
        appendMsg('assistant', `⚠ ${event.message}`)
        setBusy(false)
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

  const delConv = async (e: React.MouseEvent, id: number): Promise<void> => {
    e.stopPropagation()
    await window.api.convDelete(id)
    const list = await loadConvs()
    if (active?.id === id) setActive(list[0] ?? null)
  }

  const updateActive = (c: Conversation): void => {
    setActive(c)
    setConvs((prev) => prev.map((x) => (x.id === c.id ? c : x)))
  }

  return (
    <div className="conv-layout">
      {/* 左:对话列表 */}
      <div className="conv-list">
        <div className="head">
          <button className="primary" style={{ width: '100%' }} onClick={newConv}>
            + 新建对话
          </button>
        </div>
        <div className="items">
          {convs.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${active?.id === c.id ? 'active' : ''}`}
              onClick={() => setActive(c)}
            >
              <span className="t">{c.title}</span>
              <button className="danger" onClick={(e) => delConv(e, c.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 中:对话 */}
      <div className="conv-main">
        <div className="design-chip">
          设计稿:<b>{project?.name}</b>
          <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>(锁定,换设计稿请新建对话)</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ghost" onClick={() => setShowTree((v) => !v)}>
            {showTree ? '隐藏图层' : '查看图层'}
          </button>
        </div>
        {showTree && project && (
          <div className="tree-drawer">
            <LayerTree psdPath={project.psdPath} />
          </div>
        )}
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {confirm && (
            <div className="msg confirm">
              {confirm.prompt}
              <div className="actions">
                <button className="primary" onClick={() => answerConfirm(true)}>
                  确认
                </button>
                <button onClick={() => answerConfirm(false)}>取消</button>
              </div>
            </div>
          )}
          {busy && <div className="msg tool">思考中…</div>}
          <div ref={msgEndRef} />
        </div>
        {active && (
          <Composer conversation={active} busy={busy} onSend={send} onUpdate={updateActive} />
        )}
      </div>

      {/* 右:预览 */}
      {active && <PreviewPane conversation={active} nonce={previewNonce} />}
    </div>
  )
}
