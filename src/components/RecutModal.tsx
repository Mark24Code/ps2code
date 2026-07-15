import { useEffect, useRef, useState } from 'react'
import { Button, Modal, Progress, Steps, Table, Tag, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  FolderOpenOutlined,
  InboxOutlined,
  ScissorOutlined
} from '@ant-design/icons'
import type { RecutProgress, RecutResult } from '@shared/types'

interface Props {
  open: boolean
  conversationId: string
  onClose: () => void
}

export function RecutModal({ open, conversationId, onClose }: Props): JSX.Element {
  const [step, setStep] = useState(0) // 0=idle, 1=archive, 2=recut, 3=done
  const [message, setMessage] = useState('准备开始...')
  const [progress, setProgress] = useState<{ total?: number; current?: number }>({})
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([])
  const [successes, setSuccesses] = useState<string[]>([])
  const [result, setResult] = useState<RecutResult | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const offRef = useRef<(() => void) | null>(null)

  // 重置状态
  useEffect(() => {
    if (open) {
      setStep(0)
      setMessage('准备开始...')
      setProgress({})
      setFailures([])
      setSuccesses([])
      setResult(null)
      setRunning(false)
      setDone(false)
    }
  }, [open])

  // 监听流式进度
  useEffect(() => {
    if (!open) return
    offRef.current = window.api.onRecutProgress(({ progress: p }) => {
      setMessage(p.message)
      setProgress({ total: p.total, current: p.current })

      if (p.step === 'archive') setStep(1)
      else if (p.step === 'recut') { setStep(2) }
      else if (p.step === 'done') { setStep(3); setDone(true) }
      else if (p.step === 'error') { setMessage(`❌ ${p.message}`) }

      if (p.failures && p.failures.length > 0) setFailures(p.failures)
      if (p.successes && p.successes.length > 0) setSuccesses(p.successes)
    })
    return () => {
      offRef.current?.()
    }
  }, [open])

  const startRecut = async (): Promise<void> => {
    setRunning(true)
    setStep(1)
    setMessage('正在启动...')
    try {
      const res = await window.api.previewRecut(conversationId)
      setResult(res)
      setFailures(res.failures)
      setSuccesses(res.successes)
      setStep(3)
      setDone(true)
      setMessage(`重切完成。成功: ${res.successes.length} 个, 失败: ${res.failures.length} 个`)
    } catch (e) {
      setMessage(`错误: ${(e as Error).message}`)
      setStep(3)
      setDone(true)
    } finally {
      setRunning(false)
    }
  }

  // 打开归档目录
  const openArchiveDir = async (): Promise<void> => {
    if (result?.archivePath) {
      await window.api.openPath(result.archivePath)
    }
  }

  const stepItems = [
    { title: '归档', description: step >= 1 ? (step === 3 ? '已完成' : '进行中') : '等待...' },
    { title: '重切', description: step >= 2 ? (step === 3 ? '已完成' : '进行中') : '等待...' },
    { title: '完成', description: step >= 3 ? (done ? '完成' : '处理中') : '等待...' }
  ]

  const successColumns = [
    { title: '#', dataIndex: 'index', key: 'index', width: 40 },
    { title: '文件名', dataIndex: 'name', key: 'name', ellipsis: true }
  ]

  const failureColumns = [
    { title: '图层', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
    { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true }
  ]

  return (
    <Modal
      title={
        <span>
          <ScissorOutlined style={{ marginRight: 8 }} />
          自动重切
        </span>
      }
      open={open}
      onCancel={onClose}
      width={680}
      footer={
        step === 3 ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {result?.archivePath && (
                <Button icon={<FolderOpenOutlined />} onClick={openArchiveDir}>
                  打开归档目录
                </Button>
              )}
            </div>
            <div>
              <Button type="primary" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {!running && step === 0 && (
              <Button type="primary" icon={<ScissorOutlined />} onClick={startRecut}>
                开始重切
              </Button>
            )}
          </div>
        )
      }
    >
      {/* 步骤条 */}
      <Steps current={step} items={stepItems} style={{ marginBottom: 24 }} />

      {/* Step 1-2: 进度 */}
      {step < 3 && (
        <div className="recut-modal-step">
          <Typography.Text>{message}</Typography.Text>
          {progress.total && progress.total > 0 && (
            <Progress
              percent={Math.round(((progress.current || 0) / progress.total) * 100)}
              status={step === 3 ? 'success' : 'active'}
              style={{ marginTop: 12 }}
            />
          )}
          {step >= 2 && failures.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="danger">
                <CloseCircleFilled style={{ marginRight: 4 }} />
                已发现 {failures.length} 个失败
              </Typography.Text>
            </div>
          )}
        </div>
      )}

      {/* Step 3: 报告 */}
      {step === 3 && (
        <div>
          {/* 汇总 */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '16px 0',
                background: '#f6ffed',
                borderRadius: 8,
                border: '1px solid #b7eb8f'
              }}
            >
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 24 }} />
              <div style={{ fontSize: 24, fontWeight: 700, color: '#52c41a', marginTop: 4 }}>
                {successes.length}
              </div>
              <Typography.Text type="secondary">成功</Typography.Text>
            </div>
            <div
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '16px 0',
                background: '#fff2f0',
                borderRadius: 8,
                border: '1px solid #ffccc7'
              }}
            >
              <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 24 }} />
              <div style={{ fontSize: 24, fontWeight: 700, color: '#ff4d4f', marginTop: 4 }}>
                {failures.length}
              </div>
              <Typography.Text type="secondary">失败</Typography.Text>
            </div>
          </div>

          {/* 成功列表 */}
          {successes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Typography.Title level={5}>
                <CheckCircleFilled style={{ color: '#52c41a', marginRight: 6 }} />
                成功导出的文件
              </Typography.Title>
              <Table
                dataSource={successes.map((name, i) => ({ index: i + 1, name }))}
                columns={successColumns}
                rowKey="index"
                size="small"
                pagination={false}
                scroll={{ y: 240, x: true }}
                className="recut-table-success"
              />
            </div>
          )}

          {/* 失败列表 */}
          {failures.length > 0 && (
            <div>
              <Typography.Title level={5}>
                <CloseCircleFilled style={{ color: '#ff4d4f', marginRight: 6 }} />
                失败的条目
              </Typography.Title>
              <Table
                dataSource={failures.map((f, i) => ({ ...f, key: i }))}
                columns={failureColumns}
                rowKey="key"
                size="small"
                pagination={false}
                scroll={{ y: 200, x: true }}
                className="recut-table-fail"
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
