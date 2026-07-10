import type { ThemeConfig } from 'antd'

// 黑白灰 + 商务蓝,无渐变的高级风格
export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#1f6feb',
    colorInfo: '#1f6feb',
    colorBgLayout: '#f5f6f8',
    colorBorder: '#dfe3e8',
    borderRadius: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    colorTextBase: '#1b1f24',
    wireframe: false
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 48,
      siderBg: '#ffffff',
      bodyBg: '#f5f6f8'
    },
    Menu: {
      itemSelectedBg: '#e8f0fe',
      itemSelectedColor: '#1f6feb'
    }
  }
}
