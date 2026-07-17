import { useMemo, useRef, useState } from 'react'
import { App, Button, Input, Popover, Typography } from 'antd'
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  EllipsisOutlined,
  FolderOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import type { Conversation, Project } from '@shared/types'
import type { ConvStatus } from '../AppShell'
import { relativeTime } from '../utils/time'

export interface SidebarProps {
  projects: Project[]
  conversations: Record<number, Conversation[]> // projectId -> 对话
  activeConversationId: string | null
  convStatus: Record<string, ConvStatus>
  view: 'conversation' | 'settings' | 'welcome'
  onNewChat: () => void
  onOpenSettings: () => void
  onSelectConversation: (c: Conversation) => void
  onExpandProject: (projectId: number) => void
  onNewConversationInProject: (projectId: number) => void
  onDeleteConversation: (conv: Conversation) => void
  onDeleteProject: (project: Project) => void
  onRenameProject: (project: Project, name: string) => void
  onRenameConversation: (conv: Conversation, title: string) => void
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const {
    projects,
    conversations,
    activeConversationId,
    convStatus,
    view,
    onNewChat,
    onOpenSettings,
    onSelectConversation,
    onExpandProject,
    onNewConversationInProject,
    onDeleteConversation,
    onDeleteProject,
    onRenameProject,
    onRenameConversation
  } = props
  const { modal } = App.useApp()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const editInputRef = useRef<any>(null)
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editConvTitle, setEditConvTitle] = useState('')
  const convEditInputRef = useRef<any>(null)

  const toggle = (projectId: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else {
        next.add(projectId)
        onExpandProject(projectId)
      }
      return next
    })
  }

  // 搜索:匹配项目名或其下对话标题
  const kw = keyword.trim().toLowerCase()
  const filteredProjects = useMemo(() => {
    if (!kw) return projects
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(kw)) return true
      const convs = conversations[p.id] ?? []
      return convs.some((c) => c.title.toLowerCase().includes(kw))
    })
  }, [projects, conversations, kw])

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <button className="nav-item" onClick={onNewChat}>
          <EditOutlined />
          <span>新建对话</span>
        </button>
        <button
          className={`nav-item ${searching ? 'active' : ''}`}
          onClick={() => setSearching((s) => !s)}
        >
          <SearchOutlined />
          <span>搜索</span>
        </button>
        {searching && (
          <Input
            size="small"
            autoFocus
            allowClear
            placeholder="搜索项目 / 对话"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ margin: '4px 8px 0', width: 'calc(100% - 16px)' }}
          />
        )}
      </div>

      <div className="sidebar-scroll">
        <div className="nav-section">设计稿</div>
        {filteredProjects.length === 0 && (
          <Typography.Text type="secondary" style={{ padding: '4px 16px', fontSize: 12 }}>
            {kw ? '无匹配' : '暂无,点上方新建对话导入'}
          </Typography.Text>
        )}
        {filteredProjects.map((p) => {
          const open = expanded.has(p.id)
          const convs = conversations[p.id] ?? []
          return (
            <div key={p.id}>
              <div className="proj-row" onClick={() => toggle(p.id)}>
                <span className="caret">{open ? <DownOutlined /> : <RightOutlined />}</span>
                <FolderOutlined />
                {editingProjectId === p.id ? (
                  <Input
                    ref={editInputRef}
                    size="small"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = editName.trim()
                        if (name && name !== p.name) onRenameProject(p, name)
                        setEditingProjectId(null)
                      } else if (e.key === 'Escape') {
                        setEditingProjectId(null)
                      }
                    }}
                    onBlur={() => setEditingProjectId(null)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, height: 24 }}
                  />
                ) : (
                  <span className="proj-name" title={p.psdPath}>
                    {p.name}
                  </span>
                )}
                <Popover
                  trigger="click"
                  placement="right"
                  content={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <Button
                        type="text"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingProjectId(p.id)
                          setEditName(p.name)
                          setTimeout(() => editInputRef.current?.focus(), 0)
                        }}
                      >
                        重命名
                      </Button>
                      <Button
                        type="text"
                        danger
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          modal.confirm({
                            title: '删除设计稿',
                            content: `确定要删除「${p.name}」及其下所有对话吗？此操作不可撤销。`,
                            okText: '删除',
                            okType: 'danger',
                            cancelText: '取消',
                            onOk: () => onDeleteProject(p)
                          })
                        }}
                      >
                        删除设计稿
                      </Button>
                    </div>
                  }
                >
                  <EllipsisOutlined
                    className="proj-more"
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popover>
                <Button
                  type="text"
                  size="small"
                  className="proj-add"
                  icon={<PlusOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewConversationInProject(p.id)
                  }}
                />
              </div>
              {open &&
                convs.map((c) => {
                  const isActive = view === 'conversation' && activeConversationId === c.id
                  const st = convStatus[c.id]
                  const showBusyDot = !isActive && st?.busy
                  const showUnreadDot = !isActive && !st?.busy && st?.unread
                  return (
                    <div
                      key={c.id}
                      className={`conv-row ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (editingConvId !== c.id) onSelectConversation(c)
                      }}
                    >
                      {editingConvId === c.id ? (
                        <Input
                          ref={convEditInputRef}
                          size="small"
                          maxLength={30}
                          value={editConvTitle}
                          onChange={(e) => setEditConvTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const title = editConvTitle.trim()
                              if (title && title !== c.title) onRenameConversation(c, title)
                              setEditingConvId(null)
                            } else if (e.key === 'Escape') {
                              setEditingConvId(null)
                            }
                          }}
                          onBlur={() => {
                            const title = editConvTitle.trim()
                            if (title && title !== c.title) onRenameConversation(c, title)
                            setEditingConvId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ flex: 1, height: 24, minWidth: 0 }}
                        />
                      ) : (
                        <span className="conv-title" title={c.title}>
                          {c.title}
                        </span>
                      )}
                      {showBusyDot && <span className="conv-dot conv-dot-busy" title="进行中" />}
                      {showUnreadDot && <span className="conv-dot conv-dot-unread" title="有新结果" />}
                      <span className="conv-time">{relativeTime(c.updatedAt)}</span>
                    <span className="conv-actions">
                      <EditOutlined
                        className="conv-act-icon"
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingConvId(c.id)
                          setEditConvTitle(c.title)
                          setTimeout(() => convEditInputRef.current?.focus(), 0)
                        }}
                      />
                      <DeleteOutlined
                        className="conv-act-icon conv-act-icon--danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          modal.confirm({
                            title: '删除对话',
                            content: `确定要删除「${c.title}」吗？此操作不可撤销。`,
                            okText: '删除',
                            okType: 'danger',
                            cancelText: '取消',
                            onOk: () => onDeleteConversation(c)
                          })
                        }}
                      />
                    </span>
                  </div>
                  )
                })}
              {open && convs.length === 0 && (
                <div className="conv-empty">暂无对话,点右侧 ✎ 新建</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <button
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          onClick={onOpenSettings}
        >
          <SettingOutlined />
          <span>设置</span>
        </button>
      </div>
    </div>
  )
}
