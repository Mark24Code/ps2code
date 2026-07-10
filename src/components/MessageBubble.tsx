import { type ComponentPropsWithoutRef, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { App, Tooltip, Typography } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import type { MessageRole } from '@shared/types'

interface Props {
  role: MessageRole
  content: string
}

// ---------------------------------------------------------------------------
// CopyButton — 右上角复制快捷按钮
// ---------------------------------------------------------------------------
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const { message } = App.useApp()

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        message.success(`已复制${label}`)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1800)
      },
      () => message.error('复制失败')
    )
  }

  return (
    <Tooltip title={copied ? '已复制' : `复制${label}`}>
      <button className="md-copy-btn" onClick={handleCopy} aria-label={`复制${label}`}>
        {copied ? <CheckOutlined /> : <CopyOutlined />}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// 自定义代码块(带语法高亮标签 + 复制按钮)
// ---------------------------------------------------------------------------
function CodeBlock({ className, children, ...rest }: ComponentPropsWithoutRef<'code'>) {
  // inline code
  const match = /language-(\w+)/.exec(className ?? '')
  const isBlock = !!match || String(children).includes('\n')

  if (!isBlock) {
    return <code className="md-code-inline" {...rest}>{children}</code>
  }

  const lang = match?.[1]
  const code = String(children).replace(/\n$/, '')

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang ?? 'code'}</span>
        <CopyButton text={code} label="代码" />
      </div>
      <pre className="md-code-pre">
        <code className={className} {...rest}>{children}</code>
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 自定义表格(带复制按钮)
// ---------------------------------------------------------------------------
function TableWrapper({ children }: ComponentPropsWithoutRef<'table'>) {
  const tableRef = useRef<HTMLTableElement>(null)

  const getTableData = (): string => {
    if (!tableRef.current) return ''

    const rows = tableRef.current.querySelectorAll('tr')
    const lines: string[] = []

    for (const row of rows) {
      const cells = row.querySelectorAll('th, td')
      const line = Array.from(cells)
        .map((c) => (c.textContent ?? '').trim())
        .join('\t')
      lines.push(line)
    }

    return lines.join('\n')
  }

  return (
    <div className="md-table-wrap">
      <div className="md-table-header">
        <span className="md-table-label">表格</span>
        <CopyButton text={getTableData()} label="表格" />
      </div>
      <div className="md-table-scroll" ref={tableRef}>
        <table className="md-table">{children}</table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 自定义图片: 支持 http(s) / data: / 本地绝对路径(通过 IPC 转 base64)
// ---------------------------------------------------------------------------
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!src) return
    // http / https / data: 直接可用
    if (/^(https?:|data:)/i.test(src)) {
      setDataUrl(src)
      return
    }
    // 本地绝对路径 → 通过 IPC 转 base64 data URL
    if (src.startsWith('/') || /^[A-Za-z]:/.test(src)) {
      window.api
        .readFileAsDataUrl(src)
        .then(setDataUrl)
        .catch(() => setDataUrl(null))
      return
    }
    // 其他相对路径不处理
    setDataUrl(null)
  }, [src])

  if (!dataUrl) {
    return (
      <span className="md-img-fallback">
        📷 {alt ?? src ?? '(图片)'}
      </span>
    )
  }

  return (
    <img
      src={dataUrl}
      alt={alt ?? ''}
      className="md-img"
      style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0', cursor: 'pointer' }}
      onClick={() => window.api.openExternal(dataUrl)}
    />
  )
}

// ---------------------------------------------------------------------------
// Assistant 消息的 markdown 渲染
// ---------------------------------------------------------------------------
function AssistantContent({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code: CodeBlock,
          img: MarkdownImage,
          table: TableWrapper,
          a: ({ href, children, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          ),
          // 用 Typography 渲染 blockquote 以保持 antd 风格
          blockquote: ({ children, ...rest }) => (
            <Typography.Text type="secondary" {...rest}>
              <blockquote className="md-blockquote">{children}</blockquote>
            </Typography.Text>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------
export function MessageBubble({ role, content }: Props): JSX.Element {
  const isUser = role === 'user'
  const isTool = role === 'tool'

  const base: React.CSSProperties = {
    maxWidth: '88%',
    padding: '10px 14px',
    borderRadius: 10,
    marginBottom: 12,
    wordBreak: 'break-word',
    lineHeight: 1.5
  }

  // ---- user (纯文本) ----
  if (isUser) {
    return (
      <div
        style={{
          ...base,
          marginLeft: 'auto',
          background: 'var(--brand)',
          color: '#fff',
          whiteSpace: 'pre-wrap'
        }}
      >
        {content}
      </div>
    )
  }

  // ---- tool (等宽) ----
  if (isTool) {
    return (
      <div
        style={{
          ...base,
          background: 'var(--surface-2)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap'
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {content}
        </Typography.Text>
      </div>
    )
  }

  // ---- assistant (markdown) ----
  return (
    <div
      style={{
        ...base,
        padding: '14px 18px',
        background: '#fff',
        border: '1px solid var(--border)'
      }}
    >
      <AssistantContent content={content} />
    </div>
  )
}
