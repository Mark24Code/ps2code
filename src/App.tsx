import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { APP_NAME } from '@shared/config'

export function App(): JSX.Element {
  const nav = useNavigate()
  const loc = useLocation()
  const onHome = loc.pathname === '/'

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">{APP_NAME}</span>
        {!onHome && (
          <span className="crumb" onClick={() => nav('/')}>
            ← 主界面
          </span>
        )}
        <span className="spacer" />
        <button className="ghost" onClick={() => nav('/settings')}>
          设置
        </button>
      </div>
      <div className="page">
        <Outlet />
      </div>
    </div>
  )
}
