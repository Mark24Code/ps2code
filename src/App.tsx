import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button, Layout, Space, Typography } from 'antd'
import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons'
import { APP_NAME } from '@shared/config'

const { Header, Content } = Layout

export function App(): JSX.Element {
  const nav = useNavigate()
  const loc = useLocation()
  const onHome = loc.pathname === '/'

  return (
    <Layout style={{ height: '100%' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          WebkitAppRegion: 'drag'
        }}
      >
        <Typography.Text strong style={{ paddingLeft: 60, letterSpacing: 0.3 }}>
          {APP_NAME}
        </Typography.Text>
        {!onHome && (
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => nav('/')}
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            主界面
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => nav('/settings')}
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          设置
        </Button>
      </Header>
      <Content style={{ overflow: 'auto', minHeight: 0 }}>
        <Outlet />
      </Content>
    </Layout>
  )
}
