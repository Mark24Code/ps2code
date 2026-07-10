import { useEffect, useMemo, useState } from 'react'
import { App, Button, Divider, Empty, Image, Progress, Space, Typography } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  nonce: number
  exporting?: boolean
}

interface PreviewItem {
  name: string
  dataUrl: string
}

function Thumbs({ items }: { items: PreviewItem[] }): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        padding: '4px 12px 12px'
      }}
    >
      {items.map((it) => (
        <div
          key={it.name}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6, textAlign: 'center' }}
        >
          <Image src={it.dataUrl} alt={it.name} style={{ maxHeight: 120, objectFit: 'contain' }} />
          <Typography.Text
            ellipsis={{ tooltip: it.name }}
            style={{ display: 'block', fontSize: 11, marginTop: 4 }}
            type="secondary"
          >
            {it.name}
          </Typography.Text>
        </div>
      ))}
    </div>
  )
}

export function PreviewPane({ conversation, nonce, exporting }: Props): JSX.Element {
  const { message } = App.useApp()
  const [items, setItems] = useState<PreviewItem[]>([])
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    window.api.previewList(conversation.id).then(setItems)
  }, [conversation.id, nonce])

  const { x2, x1 } = useMemo(() => {
    const x2: PreviewItem[] = []
    const x1: PreviewItem[] = []
    for (const it of items) (/@2x\.png$/i.test(it.name) ? x2 : x1).push(it)
    return { x2, x1 }
  }, [items])

  const confirmExport = async (): Promise<void> => {
    setConfirming(true)
    try {
      const res = await window.api.exportConfirm(conversation.id)
      message.success(`已导出 ${res.count} 个文件到 ${res.dir}`)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div
      style={{
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%'
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {items.length} 个产物
        </Typography.Text>
        <span style={{ flex: 1 }} />
        <Button
          size="small"
          icon={<FolderOpenOutlined />}
          onClick={() => window.api.openPath(conversation.exportDir)}
        >
          目录
        </Button>
        <Button
          type="primary"
          size="small"
          loading={confirming}
          disabled={items.length === 0}
          onClick={confirmExport}
        >
          确认导出
        </Button>
      </div>

      {exporting && (
        <div style={{ padding: '8px 16px' }}>
          <Progress percent={100} status="active" showInfo={false} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            正在生成预览…
          </Typography.Text>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {items.length === 0 ? (
          <Empty
            style={{ marginTop: 48 }}
            description={exporting ? '正在导出,请稍候…' : '暂无预览。让 Agent 执行导出后显示在这里。'}
          />
        ) : (
          <>
            {x2.length > 0 && (
              <>
                <Divider titlePlacement="start" style={{ margin: '8px 0 0', fontSize: 12 }}>
                  2倍图({x2.length})
                </Divider>
                <Thumbs items={x2} />
              </>
            )}
            {x1.length > 0 && (
              <>
                <Divider titlePlacement="start" style={{ margin: '8px 0 0', fontSize: 12 }}>
                  1倍图({x1.length})
                </Divider>
                <Thumbs items={x1} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
