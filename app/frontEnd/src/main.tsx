import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Inter 带光学尺寸轴（opsz）：大号数字自动切到 Display 字形；Apple 设备优先用系统 SF Pro（见 index.css 字体栈）
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/geist-mono/wght.css'
import './index.css'
import { App } from './App'
import { initLocale } from './i18n'
import { injectCustomHead } from './lib/customHead'
import { initTheme } from './lib/theme'

initTheme()
initLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void injectCustomHead()
