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
    if (!psdPath.toLowerCase().endsWith('.psd')) {
      message.error('只支持 .psd 文件')
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
      setConvStatus((prev) => ({
        ...prev,
        [convId]: { busy: false, unread: false, ...prev[convId], ...patch }
      }))
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
      />
      <div className="app-content">
        {view === 'welcome' && <WelcomeView onNewChat={onNewChat} onDropPsd={importAndStart} />}
        {view === 'settings' && (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <SettingsPage />
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
