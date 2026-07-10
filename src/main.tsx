import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import './styles.css'
import { themeConfig } from './theme'
import { App } from './App'
import { HomePage } from './pages/HomePage'
import { ProjectPage } from './pages/ProjectPage'
import { SettingsPage } from './pages/SettingsPage'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <HashRouter>
          <Routes>
            <Route element={<App />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
)
