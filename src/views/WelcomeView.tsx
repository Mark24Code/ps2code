import { Typography, Upload } from 'antd'
import { PlusOutlined } from '@ant-design/icons'

interface Props {
  onNewChat: () => void
  onDropPsd: (psdPath: string) => void
}

// 欢迎页:Codex 风格居中提示 + 拖拽/点击导入设计稿
export function WelcomeView({ onNewChat, onDropPsd }: Props): JSX.Element {
  return (
    <div className="welcome">
      <Typography.Title level={3} style={{ fontWeight: 600, marginBottom: 28 }}>
        拖入一个 PSD 设计稿,开始新对话
      </Typography.Title>
      <div style={{ width: 560, maxWidth: '80%' }} onClick={onNewChat}>
        <Upload.Dragger
          multiple={false}
          showUploadList={false}
          accept=".psd"
          openFileDialogOnClick={false}
          beforeUpload={(file) => {
            onDropPsd(window.api.getPathForFile(file as unknown as File))
            return false
          }}
          style={{ background: '#fff', cursor: 'pointer', padding: '20px 0' }}
        >
          <p className="ant-upload-drag-icon" style={{ color: 'var(--brand)' }}>
            <PlusOutlined style={{ fontSize: 40 }} />
          </p>
          <p className="ant-upload-text">拖拽 PSD 到此,或点击选择文件</p>
          <p className="ant-upload-hint">相同文件会自动打开已有项目</p>
        </Upload.Dragger>
      </div>
    </div>
  )
}
