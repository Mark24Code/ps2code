import { useCallback, useEffect, useState } from 'react'
import { Modal, Spin, Typography } from 'antd'
import { ClockCircleOutlined } from '@ant-design/icons'
import type { VersionSnapshot } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: number
  onSelectVersion: (version: number) => void
  currentVersionLabel: string | null
  diffBaseVersion: number | null
}

export function VersionTimeline({
  open,
  onClose,
  projectId,
  onSelectVersion,
  currentVersionLabel,
  diffBaseVersion
}: Props): JSX.Element {
  const [versions, setVersions] = useState<VersionSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    window.api
      .versionsList(projectId)
      .then(setVersions)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <Modal
      title="文件变更历史"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnClose
      styles={{ body: { maxHeight: '60vh', overflow: 'auto', padding: 0 } }}
    >
      {loading ? (
        <Spin style={{ display: 'block', margin: '32px auto' }} />
      ) : error ? (
        <Typography.Text type="danger" style={{ display: 'block', padding: 16 }}>
          {error}
        </Typography.Text>
      ) : versions.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
          暂无版本记录。当你编辑 PSD 后回到此窗口，系统会自动创建新版本快照。
        </div>
      ) : (
        <>
          <div style={{ padding: '6px 20px 0', fontSize: 12, color: 'var(--text-3)' }}>
            选择历史版本进入开启 Diff 视图
          </div>
          <div className="version-timeline" style={{ padding: '8px 20px 12px' }}>
          {versions.map((v, idx) => {
            const isLatest = idx === 0 // versions 已按 DESC 排序
            const isSelected = v.version === diffBaseVersion
            return (
              <div
                key={v.id}
                className={`vt-item${isLatest ? ' latest' : ''}${isSelected ? ' selected' : ''}`}
                onClick={() => {
                  if (!isLatest) onSelectVersion(v.version)
                  onClose()
                }}
                style={{ cursor: isLatest ? 'default' : 'pointer' }}
              >
                <span className="vt-dot" />
                <div className="vt-row">
                  <span className="vt-name">{v.label}</span>
                  {isLatest && <span className="vt-latest-tag">最新</span>}
                  {isSelected && !isLatest && <span className="vt-diff-tag">对比中</span>}
                  <span className="vt-time">{v.createdAt}</span>
                </div>
                <div className="vt-sub">
                  <ClockCircleOutlined style={{ marginRight: 4, fontSize: 11 }} />
                  {v.createdAt}
                  <span style={{ margin: '0 8px', color: 'var(--text-3)' }}>·</span>
                  {v.size}
                </div>
              </div>
            )
          })}
        </div>
        </>
      )}
    </Modal>
  )
}
