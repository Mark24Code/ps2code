import { Typography } from 'antd'
import type { MessageRole } from '@shared/types'

interface Props {
  role: MessageRole
  content: string
}

// 对话气泡:区分 user / assistant / tool。
export function MessageBubble({ role, content }: Props): JSX.Element {
  const isUser = role === 'user'
  const isTool = role === 'tool'

  const base: React.CSSProperties = {
    maxWidth: '88%',
    padding: '10px 14px',
    borderRadius: 10,
    marginBottom: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.5
  }

  if (isUser) {
    return (
      <div
        style={{
          ...base,
          marginLeft: 'auto',
          background: 'var(--brand)',
          color: '#fff'
        }}
      >
        {content}
      </div>
    )
  }

  if (isTool) {
    return (
      <div
        style={{
          ...base,
          background: 'var(--surface-2)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {content}
        </Typography.Text>
      </div>
    )
  }

  return (
    <div
      style={{
        ...base,
        background: '#fff',
        border: '1px solid var(--border)'
      }}
    >
      {content}
    </div>
  )
}
