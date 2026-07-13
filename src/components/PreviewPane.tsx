import { useEffect, useMemo, useState, useCallback } from 'react'
import { App, Button, Checkbox, Divider, Empty, Image, Input, Progress, Space, Typography } from 'antd'
import { ExportOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  nonce: number
  exporting?: boolean
}

interface PreviewItem {
  name: string
  dataUrl: string
  w?: number
  h?: number
  x?: number
  y?: number
}

function Thumbs({
  items,
  selected,
  onToggle
}: {
  items: PreviewItem[]
  selected: Set<string>
  onToggle: (name: string, checked: boolean) => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        padding: '4px 12px 12px'
      }}
    >
      {items.map((it) => {
        const isChecked = selected.has(it.name)
        return (
          <div
            key={it.name}
            onClick={() => onToggle(it.name, !isChecked)}
            style={{
              border: isChecked ? '2px solid #1677ff' : '1px solid var(--border)',
              borderRadius: 8,
              padding: 6,
              textAlign: 'center',
              cursor: 'pointer',
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
            <Image
              src={it.dataUrl}
              alt={it.name}
              style={{ maxHeight: 120, objectFit: 'contain' }}
              preview={false}
            />
            <Typography.Text
              ellipsis={{ tooltip: it.name }}
              style={{ display: 'block', fontSize: 11, marginTop: 4 }}
              type="secondary"
            >
              {it.name}
            </Typography.Text>
            {it.w !== undefined && (
              <Typography.Text
                style={{ display: 'block', fontSize: 10, lineHeight: '15px' }}
                type="secondary"
              >
                {it.w}×{it.h}
                {it.x !== undefined ? ` · @${it.x},${it.y}` : ''}
              </Typography.Text>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PreviewPane({ conversation, nonce, exporting }: Props): JSX.Element {
  const { message } = App.useApp()
  const [items, setItems] = useState<PreviewItem[]>([])
  const [confirming, setConfirming] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.previewList(conversation.id).then((list) => {
      setItems(list)
      setSelected(new Set()) // 刷新后重置选择
    })
  }, [conversation.id, nonce])

  // 过滤
  const filtered = useMemo(() => {
    if (!filter.trim()) return items
    const kw = filter.trim().toLowerCase()
    return items.filter((it) => it.name.toLowerCase().includes(kw))
  }, [items, filter])

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

  const selectAll = selected.size > 0 && selected.size === filtered.length

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
        <Button
          size="small"
          icon={<FolderOpenOutlined />}
          onClick={() => window.api.openPath(conversation.tmpDir)}
        />
        <span style={{ flex: 1 }} />
        {selected.size > 0 && (
          <Button
            type="primary"
            size="small"
            icon={<ExportOutlined />}
            loading={confirming}
            onClick={() => doExport(Array.from(selected))}
          >
            导出选中({selected.size})
          </Button>
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
                <Thumbs items={x2} selected={selected} onToggle={toggleItem} />
              </>
            )}
            {x1.length > 0 && (
              <>
                <Divider plain style={{ margin: '4px 0 0', fontSize: 12 }}>
                  1倍图({x1.length})
                </Divider>
                <Thumbs items={x1} selected={selected} onToggle={toggleItem} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
