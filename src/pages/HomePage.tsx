import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, List, Typography, Upload } from 'antd'
import { DeleteOutlined, FileImageOutlined, PlusOutlined } from '@ant-design/icons'
import type { Project } from '@shared/types'

export function HomePage(): JSX.Element {
  const nav = useNavigate()
  const { message, modal } = App.useApp()
  const [projects, setProjects] = useState<Project[]>([])

  const refresh = (): void => {
    window.api.projectList().then(setProjects)
  }
  useEffect(refresh, [])

  const openPsd = async (psdPath: string): Promise<void> => {
    if (!psdPath.toLowerCase().endsWith('.psd')) {
      message.error('只支持 .psd 文件')
      return
    }
    const project = await window.api.projectImport(psdPath)
    nav(`/project/${project.id}`)
  }

  const onClickPick = async (): Promise<void> => {
    const path = await window.api.pickPsd()
    if (path) await openPsd(path)
  }

  const del = async (id: number): Promise<void> => {
    modal.confirm({
      title: '删除项目',
      content: '仅从列表移除记录,不影响本地设计稿文件。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await window.api.projectDelete(id)
        refresh()
      }
    })
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <div onClick={onClickPick}>
        <Upload.Dragger
          multiple={false}
          showUploadList={false}
          accept=".psd"
          openFileDialogOnClick={false}
          beforeUpload={(file) => {
            // 拖拽:用 webUtils 取真实路径(渲染进程的 File 只有 name)
            const path = window.api.getPathForFile(file as unknown as File)
            openPsd(path)
            return false // 阻止真正上传
          }}
          style={{ background: '#fff', cursor: 'pointer' }}
        >
          <p className="ant-upload-drag-icon" style={{ color: 'var(--brand)' }}>
            <PlusOutlined style={{ fontSize: 48 }} />
          </p>
          <p className="ant-upload-text">拖拽 PSD 设计稿到此,或点击选择文件</p>
          <p className="ant-upload-hint">相同文件会自动打开已有项目</p>
        </Upload.Dragger>
      </div>

      <Typography.Title level={5} style={{ marginTop: 28, color: 'var(--text-2)' }}>
        项目
      </Typography.Title>
      <List
        locale={{ emptyText: '还没有项目,先导入一个 PSD 吧' }}
        dataSource={projects}
        renderItem={(p) => (
          <List.Item
            style={{
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginBottom: 10,
              padding: '12px 16px',
              cursor: 'pointer'
            }}
            onClick={() => nav(`/project/${p.id}`)}
            actions={[
              <Button
                key="del"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  del(p.id)
                }}
              />
            ]}
          >
            <List.Item.Meta
              avatar={<FileImageOutlined style={{ fontSize: 22, color: 'var(--brand)' }} />}
              title={p.name}
              description={
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{p.psdPath}</span>
              }
            />
          </List.Item>
        )}
      />
    </div>
  )
}
