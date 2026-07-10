import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import './styles.css'
import { themeConfig } from './theme'
import { AppShell } from './AppShell'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <AppShell />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
)
