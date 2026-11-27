import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import { initMonitoring } from './lib/monitor'
import './index.css'

// 必须在 render 之前：首个渲染里抛的错也要能被捕获
initMonitoring()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Sentry.ErrorBoundary
        fallback={<div style={{ padding: 24 }}>页面出错了，已自动上报。</div>}
      >
        <ConfigProvider
          locale={zhCN}
          theme={{
            token: {
              colorPrimary: '#1677ff',
              borderRadius: 6,
            },
          }}
        >
          <AntdApp>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AntdApp>
        </ConfigProvider>
      </Sentry.ErrorBoundary>
    </StrictMode>
)
