import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from 'antd'
import type { AgentStreamEvent, Conversation, Project } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './views/ConversationView'
import { SettingsPage } from './pages/SettingsPage'
import { WelcomeView } from './views/WelcomeView'

type View = 'welcome' | 'conversation' | 'settings'

export interface ConvStatus {
  busy: boolean
  unread: boolean
}

export function AppShell(): JSX.Element {
  const { message } = App.useApp()
  const [projects, setProjects] = useState<Project[]>([])
  const [conversations, setConversations] = useState<Record<number, Conversation[]>>({})
  const [view, setView] = useState<View>('welcome')
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [convStatus, setConvStatus] = useState<Record<string, ConvStatus>>({})
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId
  const convStatusRef = useRef(convStatus)
  convStatusRef.current = convStatus

  // 全局监听 agent stream 事件,追踪各对话的 busy/unread 状态
  useEffect(() => {
    const off = window.api.onAgentStream((raw) => {
      const { conversationId: cid, event } = raw as {
        conversationId: string
        event: AgentStreamEvent
      }
      switch (event.type) {
        case 'text':
        case 'tool_use':
          setConvStatus((prev) => {
            if (prev[cid]?.busy) return prev
            return { ...prev, [cid]: { busy: true, unread: false } }
          })
          break
        case 'result':
        case 'error':
          setConvStatus((prev) => ({
            ...prev,
            [cid]: {
              busy: false,
              unread: activeConvIdRef.current !== cid
            }
          }))
          break
      }
    })
    return off
  }, [])

  const loadProjects = useCallback(async (): Promise<Project[]> => {
    const list = await window.api.projectList()
    setProjects(list)
    return list
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const loadConvs = useCallback(async (projectId: number): Promise<Conversation[]> => {
    const list = await window.api.convList(projectId)
    setConversations((prev) => ({ ...prev, [projectId]: list }))
    return list
  }, [])

  // 刷新所有已加载项目的对话(标题/时间变化时)
  const refreshLoadedConvs = useCallback(async () => {
    const ids = Object.keys(conversations).map(Number)
    for (const id of ids) await loadConvs(id)
  }, [conversations, loadConvs])

  // 导入 PSD → 建项目 → 建对话 → 打开
  const importAndStart = async (psdPath: string): Promise<void> => {
    if (!/\.(psd|psb)$/i.test(psdPath)) {
      message.error('只支持 .psd / .psb 文件')
      return
    }
    const project = await window.api.projectImport(psdPath)
    await loadProjects()
    const conv = await window.api.convCreate(project.id)
    await loadConvs(project.id)
    setActiveConvId(conv.id)
    setView('conversation')
  }

  const onNewChat = async (): Promise<void> => {
    const path = await window.api.pickPsd()
    if (path) await importAndStart(path)
  }

  const onNewConversationInProject = async (projectId: number): Promise<void> => {
    const conv = await window.api.convCreate(projectId)
    await loadConvs(projectId)
    setActiveConvId(conv.id)
    setView('conversation')
  }

  const onSelectConversation = (c: Conversation): void => {
    setActiveConvId(c.id)
    setView('conversation')
    // 清除未读标记
    setConvStatus((prev) => {
      if (!prev[c.id]?.unread) return prev
      return { ...prev, [c.id]: { ...prev[c.id], unread: false } }
    })
  }

  const onConvStatusChange = useCallback(
    (convId: string, patch: Partial<ConvStatus>) => {
      setConvStatus((prev) => {
        const cur = prev[convId] ?? { busy: false, unread: false }
        return { ...prev, [convId]: { ...cur, ...patch } }
      })
    },
    []
  )

  const onDeleteConversation = async (conv: Conversation): Promise<void> => {
    await window.api.convDelete(conv.id)
    // 如果删除的是当前活跃对话，退回到欢迎页
    if (activeConvId === conv.id) {
      setActiveConvId(null)
      setView('welcome')
    }
    // 从哪个项目来的就刷新哪个项目的对话列表
    const project = projects.find((p) => p.id === conv.projectId)
    if (project) await loadConvs(project.id)
  }

  const onDeleteProject = async (project: Project): Promise<void> => {
    // 先终止该项目下所有正在运行的对话
    const convsInProject = conversations[project.id] ?? []
    for (const c of convsInProject) {
      if (convStatusRef.current[c.id]?.busy) {
        window.api.agentCancel(c.id)
      }
    }
    await window.api.projectDelete(project.id)
    // 如果当前活跃对话属于被删除的项目，退回到欢迎页
    if (convsInProject.some((c) => c.id === activeConvId)) {
      setActiveConvId(null)
      setView('welcome')
    }
    // 刷新项目列表
    await loadProjects()
    // 清除已缓存的对话列表
    setConversations((prev) => {
      const next = { ...prev }
      delete next[project.id]
      return next
    })
  }

  const onRenameProject = async (project: Project, name: string): Promise<void> => {
    await window.api.projectUpdate(project.id, name)
    await loadProjects()
  }

  const onRenameConversation = async (conv: Conversation, title: string): Promise<void> => {
    await window.api.convUpdate(conv.id, { title })
    const project = projects.find((p) => p.id === conv.projectId)
    if (project) await loadConvs(project.id)
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        conversations={conversations}
        activeConversationId={activeConvId}
        convStatus={convStatus}
        view={view}
        onNewChat={onNewChat}
        onOpenSettings={() => setView('settings')}
        onSelectConversation={onSelectConversation}
        onExpandProject={loadConvs}
        onNewConversationInProject={onNewConversationInProject}
        onDeleteConversation={onDeleteConversation}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
        onRenameConversation={onRenameConversation}
      />
      <div className="app-content">
        {view === 'welcome' && <WelcomeView onNewChat={onNewChat} onDropPsd={importAndStart} />}
        {view === 'settings' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              className="conv-toolbar"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <span className="title">设置</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SettingsPage />
            </div>
          </div>
        )}
        {view === 'conversation' && activeConvId != null && (
          <ConversationView
            key={activeConvId}
            conversationId={activeConvId}
            onConversationUpdated={refreshLoadedConvs}
            onConvStatusChange={onConvStatusChange}
          />
        )}
      </div>
    </div>
  )
}
