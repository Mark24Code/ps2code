import { useEffect, useMemo, useState, useCallback } from 'react'
import { App, Button, Checkbox, Divider, Empty, Input, Modal, Progress, Tooltip, Typography } from 'antd'
import { AppstoreOutlined, DeleteOutlined, ExportOutlined, FolderOpenOutlined, FolderOutlined, SortAscendingOutlined, UnorderedListOutlined } from '@ant-design/icons'
import type { ArchiveFolder, Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  nonce: number
  exporting?: boolean
  onCountChange?: (count: number) => void
}

interface PreviewItem {
  name: string
  dataUrl: string
  w?: number
  h?: number
  x?: number
  y?: number
  seq: number
}

type ViewMode = 'grid' | 'list'

function GridThumbs({
  items,
  selected,
  onToggle,
  onHover
}: {
  items: PreviewItem[]
  selected: Set<string>
  onToggle: (name: string, checked: boolean) => void
  onHover: (it: PreviewItem | null) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '4px 12px 12px' }}>
      {items.map((it) => {
        const isChecked = selected.has(it.name)
        return (
          <div
            key={it.name}
            onMouseEnter={() => onHover(it)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onToggle(it.name, !isChecked)}
            style={{
              border: isChecked ? '2px solid #1677ff' : '1px solid var(--border)',
              borderRadius: 8, padding: 6, textAlign: 'center', cursor: 'pointer',
              background: isChecked ? '#e6f4ff' : '#fff',
              transition: 'border-color .2s, background .2s'
            }}
          >
            <Checkbox
              checked={isChecked}
              style={{ float: 'left', margin: 0 }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggle(it.name, e.target.checked)}
            />
            <img src={it.dataUrl} alt={it.name} style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }} />
            <Typography.Text ellipsis={{ tooltip: it.name }} style={{ display: 'block', fontSize: 11, marginTop: 4 }} type="secondary">
              {it.name}
            </Typography.Text>
            {it.w !== undefined && (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 10, lineHeight: '15px' }}>
                {it.w}×{it.h}{it.x !== undefined ? ` · @${it.x},${it.y}` : ''}
              </Typography.Text>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ListThumbs({
  items,
  selected,
  onToggle,
  onHover
}: {
  items: PreviewItem[]
  selected: Set<string>
  onToggle: (name: string, checked: boolean) => void
  onHover: (it: PreviewItem | null) => void
}): JSX.Element {
  return (
    <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it) => {
        const isChecked = selected.has(it.name)
        return (
          <div
            key={it.name}
            onMouseEnter={() => onHover(it)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onToggle(it.name, !isChecked)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 6,
              border: isChecked ? '2px solid #1677ff' : '1px solid var(--border)',
              borderRadius: 8, cursor: 'pointer',
              background: isChecked ? '#e6f4ff' : '#fff',
              transition: 'border-color .2s, background .2s'
            }}
          >
            <Checkbox checked={isChecked} onClick={(e) => e.stopPropagation()} onChange={(e) => onToggle(it.name, e.target.checked)} />
            <div style={{ width: 48, height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 4, overflow: 'hidden' }}>
              <img src={it.dataUrl} alt={it.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text ellipsis={{ tooltip: it.name }} style={{ display: 'block', fontSize: 12, lineHeight: '18px' }}>{it.name}</Typography.Text>
              {it.w !== undefined && (
                <Typography.Text type="secondary" style={{ fontSize: 10, lineHeight: '15px' }}>
                  {it.w}×{it.h}{it.x !== undefined ? ` · @${it.x},${it.y}` : ''}
                </Typography.Text>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PreviewPane({ conversation, nonce, exporting, onCountChange }: Props): JSX.Element {
  const { message } = App.useApp()
  const [items, setItems] = useState<PreviewItem[]>([])
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortAsc, setSortAsc] = useState(false) // false=从新到旧(desc,默认), true=从旧到新(asc)
  const [archiveFolders, setArchiveFolders] = useState<ArchiveFolder[]>([])
  const [archivesExpanded, setArchivesExpanded] = useState(false)

  useEffect(() => {
    window.api.previewList(conversation.id).then((list) => {
      setItems(list)
      setSelected(new Set()) // 刷新后重置选择
      onCountChange?.(list.length)
    })
  }, [conversation.id, nonce, onCountChange])

  // 加载归档文件夹列表
  useEffect(() => {
    window.api.previewArchiveList(conversation.id).then((folders) => {
      setArchiveFolders(folders)
    }).catch(() => { /* 归档目录可能还不存在 */ })
  }, [conversation.id, nonce])

  // 过滤 + 按导出顺序(seq)排序
  const filtered = useMemo(() => {
    let list = items
    if (filter.trim()) {
      const kw = filter.trim().toLowerCase()
      list = list.filter((it) => it.name.toLowerCase().includes(kw))
    }
    return [...list].sort((a, b) => sortAsc ? a.seq - b.seq : b.seq - a.seq)
  }, [items, filter, sortAsc])

  const { x2, x1 } = useMemo(() => {
    const x2: PreviewItem[] = []
    const x1: PreviewItem[] = []
    for (const it of filtered) (/@2x\.png$/i.test(it.name) ? x2 : x1).push(it)
    return { x2, x1 }
  }, [filtered])

  const toggleItem = useCallback((name: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      checked ? next.add(name) : next.delete(name)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelected(new Set(filtered.map((it) => it.name)))
      } else {
        setSelected(new Set())
      }
    },
    [filtered]
  )

  const doExport = async (names?: string[]): Promise<void> => {
    setConfirming(true)
    try {
      const res = await window.api.exportConfirm(conversation.id, names)
      const label = names ? `已导出 ${res.count} 个文件到 ${res.dir}` : `已导出全部 ${res.count} 个文件到 ${res.dir}`
      message.success(label)
    } finally {
      setConfirming(false)
    }
  }

  const doDelete = async (): Promise<void> => {
    Modal.confirm({
      title: '删除预览图片',
      content: `确定要删除选中的 ${selected.size} 张图片吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true)
        try {
          const res = await window.api.previewDelete(conversation.id, Array.from(selected))
          message.success(`已删除 ${res.deleted} 张图片`)
          setSelected(new Set())
          // 强制刷新预览列表
          setItems((prev) => prev.filter((it) => !selected.has(it.name)))
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const selectAll = selected.size > 0 && selected.size === filtered.length
  const Thumbs = viewMode === 'grid' ? GridThumbs : ListThumbs

  // 空格放大预览
  const [hoveredItem, setHoveredItem] = useState<PreviewItem | null>(null)
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      // 避免在输入框中触发
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (previewItem) {
        setPreviewItem(null)
      } else if (hoveredItem) {
        setPreviewItem(hoveredItem)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoveredItem, previewItem])

  return (
    <div
      style={{
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}
    >
      {/* ---- 工具栏(固定) ---- */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {items.length} 个产物
        </Typography.Text>
        <span style={{ borderLeft: '1px solid var(--border)', height: 18, margin: '0 2px' }} />
        <Tooltip title="网格视图">
          <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={() => setViewMode('grid')}
            style={{ color: viewMode === 'grid' ? 'var(--brand)' : 'var(--text-3)', padding: '0 4px' }} />
        </Tooltip>
        <Tooltip title="列表视图">
          <Button type="text" size="small" icon={<UnorderedListOutlined />} onClick={() => setViewMode('list')}
            style={{ color: viewMode === 'list' ? 'var(--brand)' : 'var(--text-3)', padding: '0 4px' }} />
        </Tooltip>
        <span style={{ borderLeft: '1px solid var(--border)', height: 18, margin: '0 2px' }} />
        <Tooltip title={sortAsc ? '从旧到新' : '从新到旧'}>
          <Button type="text" size="small" icon={<SortAscendingOutlined style={{ transform: sortAsc ? 'scaleY(1)' : 'scaleY(-1)' }} />} onClick={() => setSortAsc((v) => !v)}
            style={{ color: 'var(--text-2)', padding: '0 4px' }} />
        </Tooltip>
        <Tooltip title="打开临时目录">
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => window.api.openPath(conversation.tmpDir)}
          />
        </Tooltip>
        <span style={{ flex: 1 }} />
        {selected.size > 0 && (
          <>
            <Button
              type="primary"
              size="small"
              icon={<ExportOutlined />}
              loading={confirming}
              onClick={() => doExport(Array.from(selected))}
            >
              导出选中({selected.size})
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
              onClick={doDelete}
            >
              删除选中({selected.size})
            </Button>
          </>
        )}
        <Button
          size="small"
          icon={<ExportOutlined />}
          loading={confirming && selected.size === 0}
          disabled={items.length === 0}
          onClick={() => doExport()}
        >
          导出全部
        </Button>
      </div>

      {/* ---- 筛选栏(固定) ---- */}
      {items.length > 0 && (
        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Checkbox checked={selectAll} indeterminate={selected.size > 0 && !selectAll} onChange={(e) => toggleAll(e.target.checked)} />
          <Input.Search
            size="small"
            placeholder="筛选图层名…"
            allowClear
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onSearch={setFilter}
            style={{ flex: 1 }}
          />
        </div>
      )}

      {exporting && (
        <div style={{ padding: '8px 16px' }}>
          <Progress percent={100} status="active" showInfo={false} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            正在生成预览…
          </Typography.Text>
        </div>
      )}

      {/* ---- 缩略图区(可滚动) ---- */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {items.length === 0 ? (
          <Empty
            style={{ marginTop: 48 }}
            description={exporting ? '正在导出,请稍候…' : '暂无预览。让 Agent 执行导出后显示在这里。'}
          />
        ) : filtered.length === 0 ? (
          <Empty style={{ marginTop: 48 }} description="没有匹配的图片" />
        ) : (
          <>
            {x2.length > 0 && (
              <>
                <Divider plain style={{ margin: '4px 0 0', fontSize: 12 }}>
                  2倍图({x2.length})
                </Divider>
                <Thumbs items={x2} selected={selected} onToggle={toggleItem} onHover={setHoveredItem} />
              </>
            )}
            {x1.length > 0 && (
              <>
                <Divider plain style={{ margin: '4px 0 0', fontSize: 12 }}>
                  1倍图({x1.length})
                </Divider>
                <Thumbs items={x1} selected={selected} onToggle={toggleItem} onHover={setHoveredItem} />
              </>
            )}
          </>
        )}

        {/* ---- 归档文件夹 ---- */}
        {archiveFolders.length > 0 && (
          <div style={{ padding: '0 12px 12px' }}>
            <Divider
              plain
              style={{ margin: '8px 0', fontSize: 12 }}
            >
              <span
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setArchivesExpanded(!archivesExpanded)}
              >
                <FolderOutlined style={{ marginRight: 4 }} />
                归档备份 ({archiveFolders.length})
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)' }}>
                  {archivesExpanded ? '点击收起' : '点击展开'}
                </span>
              </span>
            </Divider>
            {archivesExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {archiveFolders.map((folder) => (
                  <div
                    key={folder.name}
                    className="archive-folder-item"
                    onClick={() => window.api.openPath(folder.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'background .15s, border-color .15s'
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#f5f5f5'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--brand)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    }}
                  >
                    <FolderOpenOutlined style={{ fontSize: 20, color: '#faad14' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text
                        ellipsis={{ tooltip: folder.name }}
                        style={{ display: 'block', fontSize: 12, fontWeight: 500 }}
                      >
                        {folder.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {folder.fileCount} 个文件
                      </Typography.Text>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 空格放大预览 Modal */}
      {previewItem && (
        <div
          onClick={() => setPreviewItem(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.65)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out'
          }}
        >
          <img
            src={previewItem.dataUrl}
            alt={previewItem.name}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 16 }}
          />
        </div>
      )}
    </div>
  )
}
