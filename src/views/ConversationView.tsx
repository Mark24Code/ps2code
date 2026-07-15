import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Drawer, Empty, Space, Spin, Tooltip, Typography } from 'antd'
import {
  FolderOpenOutlined,
  FolderOutlined,
  PictureOutlined,
  ProfileOutlined
} from '@ant-design/icons'
import type {
  AgentStreamEvent,
  Conversation,
  Message,
  Project,
  VersionDiffResult,
  VersionSnapshot
} from '@shared/types'
import { Composer } from '../components/Composer'
import { PreviewPane } from '../components/PreviewPane'
import { LayerTree } from '../components/LayerTree'
import { RecutModal } from '../components/RecutModal'
import { VersionTimeline } from '../components/VersionTimeline'
import { MessageBubble } from '../components/MessageBubble'
import { ThinkingBubble } from '../components/ThinkingBubble'

interface StreamPayload {
  conversationId: string
  event: AgentStreamEvent
}

type Ready = { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string }

interface Props {
  conversationId: string
  onConversationUpdated: () => void // 通知外层刷新侧栏(标题/时间)
  onConvStatusChange: (convId: string, patch: { busy?: boolean; unread?: boolean }) => void
}

export function ConversationView({ conversationId, onConversationUpdated, onConvStatusChange }: Props): JSX.Element {
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
  const [rightTab, setRightTab] = useState<'preview' | 'layers' | 'diff'>('preview')
  const msgEndRef = useRef<HTMLDivElement>(null)

  // 重切
  const [recutModalOpen, setRecutModalOpen] = useState(false)
  const [previewCount, setPreviewCount] = useState(0)

  // 版本管理
  const [latestVersion, setLatestVersion] = useState<VersionSnapshot | null>(null)
  const [diffBaseVersion, setDiffBaseVersion] = useState<number | null>(null)
  const [diffData, setDiffData] = useState<VersionDiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)

  // 右侧面板可拖拽宽度
  const [rightWidth, setRightWidth] = useState(680)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(420)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    startXRef.current = e.clientX
    startWRef.current = rightWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [rightWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = startXRef.current - e.clientX
      const next = Math.max(280, Math.min(700, startWRef.current + delta))
      setRightWidth(next)
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

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

  // 就绪门控:确保 PS 打开对应设计稿,并完成数据准备(dump 图层缓存文件)
  const ensureReady = useCallback(
    (psdPath: string) => {
      setReady({ state: 'loading' })
      window.api
        .psOpenDesign(psdPath)
        .then(async (res) => {
          if (!res.ok) {
            setReady({ state: 'error', message: res.message })
            return
          }
          // 数据准备:把图层树 dump 到本对话缓存文件(失败不阻断,Agent 侧会回退现读)
          try {
            await window.api.layersPrepare(conversationId)
          } catch {
            /* 忽略:缓存准备失败不阻断进入对话 */
          }
          setReady({ state: 'ok', message: res.message })
        })
        .catch((e) => setReady({ state: 'error', message: String(e) }))
    },
    [conversationId]
  )

  useEffect(() => {
    if (project) ensureReady(project.psdPath)
  }, [project, conversationId, ensureReady])

  // 版本检查:进入对话时触发一次
  useEffect(() => {
    if (!project) return
    let cancelled = false
    window.api.versionsCheck(project.id).then((r) => {
      if (cancelled) return
      setLatestVersion(r.snapshot)
    }).catch(() => { /* 静默失败 */ })
    // 初始加载版本列表(供 timeline 使用;不阻塞)
    window.api.versionsList(project.id).catch(() => {})
    return () => { cancelled = true }
  }, [project])

  // 窗口重新聚焦 → 检查 PSD 是否有变化
  useEffect(() => {
    if (!project) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onWindowFocused(() => {
      if (timer) clearTimeout(timer)
      // 防抖:用户可能频繁切回
      timer = setTimeout(async () => {
        try {
          const r = await window.api.versionsCheck(project.id)
          setLatestVersion(r.snapshot)
          // 若正处于 diff 模式,刷新 diff 数据(最新版变了)
          if (diffBaseVersion !== null && r.created) {
            loadDiff(project.id, diffBaseVersion)
          }
        } catch { /* 静默 */ }
      }, 800)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [project, diffBaseVersion])

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
    onConvStatusChange(conversationId, { busy: true })
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

  // ---------- 版本 Diff ----------
  const loadDiff = useCallback(async (pid: number, baseVersion: number) => {
    setDiffLoading(true)
    try {
      const result = await window.api.versionsDiff(pid, baseVersion)
      setDiffData(result)
      setDiffBaseVersion(baseVersion)
    } catch (e) {
      setDiffData(null)
    } finally {
      setDiffLoading(false)
    }
  }, [])

  const enterDiffMode = useCallback((baseVersion: number) => {
    if (!project) return
    loadDiff(project.id, baseVersion)
    setRightTab('diff')
  }, [project, loadDiff])

  const exitDiffMode = useCallback(() => {
    setDiffBaseVersion(null)
    setDiffData(null)
    setRightTab('preview')
  }, [])

  if (!conv || !project) return <Spin style={{ margin: 'auto' }} />



  /** 把序列化文本中的 ◈ 替换为文件夹/图层图标 */
  function renderLine(text: string | null): React.ReactNode {
    if (!text) return ''
    const idx = text.indexOf('◈')
    if (idx === -1) return <>{text}</>
    const indent = text.slice(0, idx)
    const rest = text.slice(idx + 1).trimStart()
    const isGroup = /\s*\(group\)/.test(rest)
    const clean = rest.replace(/\s+\((group|layer)\)/, '')
    return (
      <>
        {indent}
        <span className="diff-line-icon">
          {isGroup ? <FolderOutlined /> : <PictureOutlined />}
        </span>
        {clean}
      </>
    )
  }

  function renderDiffContent(): JSX.Element {
    if (diffLoading) {
      return <Spin style={{ display: 'block', margin: '48px auto' }} />
    }
    if (!diffData) {
      return <Empty description="加载差异数据失败" style={{ marginTop: 48 }} />
    }
    const { lines, summary, baseVersion, targetVersion } = diffData

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 列头 */}
        <div className="diff-header">
          <svg className="diff-header-icon" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="3" width="7" height="14" rx="1" />
            <rect x="11.5" y="3" width="7" height="14" rx="1" />
          </svg>
          <span className="diff-header-left">v{baseVersion}</span>
          <span className="diff-header-arrow">→</span>
          <span className="diff-header-right">v{targetVersion}（最新）</span>
          <span className="diff-header-counts">
            <span className="diff-count-add">+{summary.add}</span>
            <span className="diff-count-del">-{summary.del}</span>
            <span className="diff-count-mod">~{summary.mod}</span>
          </span>
        </div>

        {/* Diff 表格 + Minimap 标尺 */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            className="diff-scroll"
            ref={(el) => { (window as any).__diffScroll = el }}
            onScroll={() => {
              const el = (window as any).__diffScroll as HTMLElement | null
              const vp = (window as any).__diffViewport as HTMLElement | null
              if (!el || !vp) return
              const sh = el.scrollHeight - el.clientHeight
              const rh = el.clientHeight - vp.offsetHeight
              vp.style.top = sh > 0 ? `${(el.scrollTop / sh) * rh}px` : '0px'
            }}
          >
            <table className="diff-table">
              <tbody>
                {lines.map((line, i) => {
                  const isMod = line.type === 'chg' && line.left && line.right
                  const isDel = line.type === 'chg' && line.left && !line.right
                  const isAdd = line.type === 'chg' && !line.left && line.right
                  let lCls = ''
                  let rCls = ''
                  if (isDel) { lCls = 'l-del'; rCls = 'empty' }
                  else if (isAdd) { lCls = 'empty'; rCls = 'r-add' }
                  else if (isMod) { lCls = 'l-mod'; rCls = 'r-mod' }
                  return (
                    <tr key={i} data-diff-row={i}>
                      <td className={lCls}>{renderLine(line.left)}</td>
                      <td className={rCls}>{renderLine(line.right)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Minimap 标尺:红/绿/橙色块 + 视口指示器,点击跳转行 */}
          <div className="diff-ruler" ref={(el) => { (window as any).__diffRuler = el }}>
            <div className="diff-ruler-viewport" ref={(el) => { (window as any).__diffViewport = el }} />
            {lines.map((line, i) => {
              const isMod = line.type === 'chg' && line.left && line.right
              const isDel = line.type === 'chg' && line.left && !line.right
              const isAdd = line.type === 'chg' && !line.left && line.right
              const color = isDel ? '#dc2626' : isAdd ? '#16a34a' : isMod ? '#d97706' : 'transparent'
              return (
                <div
                  key={i}
                  className="diff-ruler-line"
                  style={{ background: color }}
                  onClick={() => {
                    const container = (window as any).__diffScroll as HTMLDivElement | null
                    if (!container) return
                    const row = container.querySelector(`[data-diff-row="${i}"]`)
                    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const gateDisabled = ready.state !== 'ok'

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
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
            <Space>
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={async () => {
                  const path = await window.api.agentLogsPath(conversationId)
                  window.api.openPath(path)
                }}
              >
                打开日志目录
              </Button>
              <Button
                size="small"
                onClick={() => window.api.agentLogs(conversationId).then(setLogs)}
              >
                刷新
              </Button>
            </Space>
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
          psdPath={project.psdPath}
          readyState={ready.state}
          readyMessage={ready.message}
          latestVersion={latestVersion}
          diffBaseVersion={diffBaseVersion}
          diffData={diffData}
          previewCount={previewCount}
          onOpenTimeline={() => setTimelineOpen(true)}
          onExitDiffMode={exitDiffMode}
          onSend={send}
          onStop={() => {
            window.api.agentCancel(conversationId)
            setBusy(false)
            appendMsg('tool', '⏹ 已停止')
          }}
          onUpdate={updateConv}
          onRecut={() => setRecutModalOpen(true)}
        />
      </div>

      {/* 拖拽分割条 */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          width: 5,
          cursor: 'col-resize',
          flexShrink: 0,
          background: 'transparent',
          transition: 'background .15s',
          zIndex: 10
        }}
        onMouseEnter={(e) => { if (!draggingRef.current) (e.target as HTMLElement).style.background = 'var(--border)' }}
        onMouseLeave={(e) => { if (!draggingRef.current) (e.target as HTMLElement).style.background = 'transparent' }}
      />

      {/* 右侧面板(可拖拽宽度) */}
      <div style={{ width: rightWidth, height: '100%', overflow: 'hidden', borderLeft: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 自定义 Tab 栏 */}
        <div style={{
          display: 'flex', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          padding: '0 12px'
        }}>
          {(
            [
              ['preview', '导出预览'],
              ['layers', '图层结构'],
              ...(diffBaseVersion !== null ? [['diff', '图层 Diff']] : [])
            ]
          ).map(([key, label]) => (
            <div
              key={key}
              onClick={() => setRightTab(key as typeof rightTab)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: rightTab === key ? 600 : 400,
                color: rightTab === key ? 'var(--brand)' : 'var(--text-2)',
                borderBottom: rightTab === key ? '2px solid var(--brand)' : '2px solid transparent',
                transition: 'color .15s, border-color .15s',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Tab 内容 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {rightTab === 'preview' && (
            <PreviewPane conversation={conv} nonce={previewNonce} exporting={exporting} onCountChange={setPreviewCount} />
          )}
          {rightTab === 'layers' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div style={{ padding: 12 }}>
                <LayerTree conversationId={conversationId} />
              </div>
            </div>
          )}
          {rightTab === 'diff' && renderDiffContent()}
        </div>
      </div>

      {/* 版本 Timeline Modal */}
      {project && (
        <VersionTimeline
          open={timelineOpen}
          onClose={() => setTimelineOpen(false)}
          projectId={project.id}
          currentVersionLabel={latestVersion?.label ?? null}
          diffBaseVersion={diffBaseVersion}
          onSelectVersion={(v) => enterDiffMode(v)}
        />
      )}

      {/* 自动重切 Modal */}
      <RecutModal
        open={recutModalOpen}
        conversationId={conversationId}
        onClose={() => {
          setRecutModalOpen(false)
          // 重切后刷新预览
          setPreviewNonce((n) => n + 1)
        }}
      />
    </div>
  )
}
