# AirPulse · 空脉 — 5G 随身热点与无线射频管理面板重构指南

## 1. 项目定位与品牌重塑

本项目名为 **AirPulse · 空脉**（目录 `/Users/kittors/Developer/opensource/AirPulse`），是基于中兴 F50 / U30 Air 5G 随身 Wi-Fi 底层能力打造的**新一代 5G 随身热点与无线射频管理面板**。

- **品牌彻底焕新**：
  - 项目正式名称为 **`AirPulse`**（中文名：**空脉**）。
  - Web 页面标题（`<title>`）、PWA `manifest.json`、导航栏品牌标识、登录页、关于页、页脚、本地存储键名前缀，以及 APK 应用名称（`strings.xml` 中的 `app_name` 与构建产物命名）均需统一使用 **AirPulse**，**严禁在界面上残留原版 `UFI-TOOLS` 名称、旧版粗糙 Logo、打赏二维码或加群广告图片**。
- **核心目标**：
  - 彻底推翻原版简陋粗糙的原生 HTML/JS 界面，使用**最新现代前端技术栈**从零重构一套**简洁、优雅、极具设计感、阅读体验优秀、交互完美**的现代化 Web 控制台，同时 100% 完整保留并对接底层所有 `/api/*` 接口能力。

---

## 2. 强制技术栈要求（最新现代前端工程）

前端在 `app/frontEnd` 下使用最新现代前端技术栈重新搭建（可参考同级仓库 `/Users/kittors/Developer/opensource/HotspotGate/web` 与 `/Users/kittors/Developer/opensource/Sonar/apps/dashboard`）：

- **核心框架**：**React 19** + **TypeScript 5.8+**（严格类型检查 `tsc -b`）
- **构建工具**：**Vite 6**（开发态 `npm run dev` 热更新 + `/api` 代理；生产态 `npm run build` 编译输出到 Android `assets`）
- **样式方案**：**Tailwind CSS v4**（`@tailwindcss/vite`）+ `clsx` + `tailwind-merge`
- **无头组件库**：**Radix UI**（`@radix-ui/react-select`、`@radix-ui/react-dialog`、`@radix-ui/react-switch`、`@radix-ui/react-tabs`、`@radix-ui/react-dropdown-menu`、`@radix-ui/react-tooltip`、`@radix-ui/react-popover` 等）
- **图标与字体**：
  - 图标统一使用 **Lucide React**（`lucide-react`），线条干净统一。
  - 字体本地打包引入 **`@fontsource-variable/geist`** 与 **`@fontsource-variable/geist-mono`**（搭配系统中文无衬线字体栈），所有实时数值、信号读数（RSRP/SINR/RSRQ）、频段号、PCI/EARFCN、网速与流量统一开启 **`tabular-nums`（等宽数字）**，防止数值刷新时版面抖动。
- **100% 离线局域网可用（硬性要求）**：
  - 随身 Wi-Fi 处于无外网或断网排障场景时，用户仍需通过 `http://192.168.0.1:2333` 打开 AirPulse 切换选网或锁频。
  - **所有字体、图标、JS/CSS 资源必须 100% 本地打包进构建产物**，严禁依赖任何外部 CDN（如 Google Fonts、unpkg、jsdelivr 等）。

---

## 3. UI 视觉、排版阅读与交互铁律（最高优先级）

### 3.1 严禁出现任何浏览器原生 / 系统组件（零容忍）
1. **禁止系统下拉框**：页面中**绝对不允许出现原生的 `<select>` / `<option>` 系统下拉菜单**（如选网模式 5G SA/NSA/4G 切换、频段选择、定时周期、语言切换等）。必须全部使用基于 **Radix Select** 或 **分段控制器（Segmented Control / Pill Tabs）** 定制的高颜值组件，带圆角浮层、细腻描边、键盘导航、选中态高亮与平滑过渡。
2. **禁止系统复选框 / 单选框 / 原生开关**：
   - 5G/4G 频段锁（如 `n1 / n5 / n8 / n28 / n41 / n78`、`B1 / B3 / B5 / B8 / B34 / B38 / B39 / B40 / B41`）禁止使用丑陋的原生 `<input type="checkbox">`，必须设计成**可交互的频段芯片矩阵（Interactive Band Chips / Toggle Pills）**，一眼看清当前激活频段与已锁频段。
   - 所有开关项必须使用精心设计的 **Custom Switch（带平滑弹簧位移与状态色彩过渡）**。
3. **禁止系统原生输入框样式与数字微调箭头**：
   - 所有文本/数字/密码输入框必须封装为统一的定制 `Input` / `PasswordInput` 组件，彻底移除浏览器默认 `outline`、系统内阴影与 `<input type="number">` 的上下小箭头，提供清晰的容器背景、细腻边框、聚焦光环（Focus Ring）以及内嵌操作按钮（如密码显隐切换、一键清空、单位后缀标签）。
4. **禁止系统原生弹窗与原生滚动条**：
   - **严禁调用 `window.alert()`、`window.confirm()`、`window.prompt()`**。所有确认拦截（如重启设备、恢复出厂、切换可能断网的纯 5G SA 模式、重置锁小区）、表单弹窗、AT 指令输出详情必须使用定制的 **Modal Dialog / Drawer** 与右上角/底部优雅的 **Toast 通知系统**。
   - 自定义滚动条与过渡动画，杜绝生硬突兀的浏览器默认控件外观。

### 3.2 简洁、优雅、有设计感与极佳的阅读体验
1. **信息层级分明，一眼看清核心状态**：
   - 首屏顶部/核心区聚焦最关键的实时脉搏：**当前网络制式（5G SA / 5G NSA / 4G LTE）与运营商、实时上下行速率、核心射频指标（RSRP / SINR / RSRQ / 当前频段 Band / PCI / EARFCN）以及机身温度 / CPU / 内存 / 电池或供电状态**。
   - **数字是主角**：核心读数采用大字号 + `Geist Mono` 等宽字体（`tabular-nums`），单位小一号、颜色退一档；辅以直观的信号质量色阶（极佳/良好/一般/微弱）与精致的实时平滑波形/进度条。
2. **克制而高级的色彩与明暗双主题**：
   - 大面积舒适留白、细腻的卡片层次（背景底色 `bg`、卡片表面 `surface`、凹陷轨道区 `sunken`、1px 低对比度微边框 `border`），避免杂乱的彩虹色和高饱和刺眼色块。
   - 原生支持 **浅色模式（Light）** 与 **深色模式（Dark）**（可跟随系统或一键丝滑切换），两套主题下的文字对比度、卡片层次、发光点缀色都必须经过精细调校。
3. **动作就近与即时反馈**：
   - 操作控件紧挨着它所影响的状态卡片放置（例如：在「射频与基站」卡片内直接切换选网模式、点选锁频芯片、查看邻区列表并点击某一行邻区直接「一键锁定该小区 PCI/EARFCN」）。
   - 每个按钮点击、开关切换、指令发送都必须有明确的 Loading 态、乐观更新或微动效反馈；危险操作（如锁死纯 5G、重启设备、恢复设置）提供清晰的二次确认提示。
4. **响应式布局**：
   - 桌面端（Mac / PC 浏览器访问 `192.168.0.1:2333`）采用优雅的多列仪表盘/分栏布局，充分利用宽屏空间；移动端浏览器访问时自适应为单列流式布局与底部/抽屉导航，触控热区充裕（最小 40px 高度）。

---

## 4. 核心功能模块清单（须完整对接后端 `/api/*`）

所有接口定义详见根目录 `API_Doc.md` 及原版前端 `app/frontEnd/public/script/requests.js`、`main.js`：

1. **鉴权与会话管理**：
   - Token / 口令登录弹窗（支持记住口令、优雅的错误提示、修改管理口令）。
2. **实时脉搏仪表盘（Overview / Telemetry）**：
   - 运营商、网络制式（5G SA / NSA / 4G）、实时上下行网速、当月/今日流量统计与限额管理。
   - 射频核心指标可视化：RSRP（接收功率 dBm）、SINR（信噪比 dB）、RSRQ、信号格数、当前驻留 Band、EARFCN（频点）、PCI（物理小区 ID）、Cell ID。
   - 硬件健康度：CPU 实时负载与各核频率、内存占用、机身/基带传感器实时温度、运行时间（Uptime）、外接供电/充电状态。
3. **蜂窝网络与射频调优（Radio & Band / Cell Lock）**：
   - **选网模式切换**（分段控件：5G/4G/3G 自动、5G NSA、仅 5G SA、仅 4G 等）。
   - **5G NR / 4G LTE 频段锁（Band Lock）**：可视化频段芯片多选与一键全选/解锁。
   - **邻区扫描与锁小区（Cell Lock）**：以高可读性的表格/卡片展示 `neighbor_cell_info`（频段、EARFCN、PCI、RSRP 信号强度条、RSRQ、SINR），支持直接在邻区列表上点击「锁定此小区」以及「一键解除全部小区锁」。
4. **Wi-Fi 热点与接入设备管理（Hotspot & Clients）**：
   - 2.4G / 5G Wi-Fi 开关、SSID、密码、信道、带宽、最大连接数、Wi-Fi 功率/性能模式设置。
   - 当前已连接客户端列表（设备名称、IP、MAC、连接方式 USB / Wi-Fi）。
5. **短信中心与自动转发（SMS & Forwarding）**：
   - 收件箱/发件箱对话式或清爽列表式阅读体验、发送新短信、删除短信。
   - 短信自动转发配置（Webhook / 企业微信 / 钉钉 / Bark / 邮件 / Telegram 等转发规则配置与测试发送）。
6. **高级开发者工具箱（Advanced & System Tools）**：
   - **AT 指令终端**：内置常用 AT 指令快捷预设 + 自定义 AT 指令输入与格式化高亮响应展示。
   - **系统与网络工具**：ADB 网络调试开关、Samba 文件共享开关、内网穿透/代理控制、测速（Speedtest / iperf3）、定时任务管理（Scheduled Tasks）、Web 终端（`http://192.168.0.1:1146`）内嵌或快捷唤起、设备重启与日志查看。

---

## 5. 仓库目录与构建流水线规范

- **仓库根目录**：`/Users/kittors/Developer/opensource/AirPulse`
- **完整后端 API 文档**：`API_Doc.md`（根目录）
- **前端工程目录**：`app/frontEnd/`
  - 在开发重构前，可先将原版 `app/frontEnd/public/` 备份至 `app/frontEnd/legacy-public/` 以便随时对照原版 `main.js` / `requests.js` 的接口调用细节。
- **Android 静态资源挂载机制**：
  - `app/src/main/java/com/minikano/f50_sms/modules/staticFileModule.kt` 直接从 APK 的 `assets/` 根目录提供静态文件服务（访问 `/` 返回 `assets/index.html`）。
  - **关键防坑规则**：`app/src/main/assets/shell/` 目录中存放着 Android 后端运行必需的二进制工具与脚本（`adb`、`curl`、`imei_reader`、`iperf3`、`jq`、`login.sh`、`samba_exec.sh`、`sendat`、`sha256`、`socat`、`temp.sh`、`ttyd`、`ufi_keep_alive.sh`、`ufi_req`、`zreq` 等）。
  - 因此，配置 Vite 构建输出到 `app/src/main/assets` 时，**绝对不能设置 `emptyOutDir: true` 直接清空整个 `assets/` 目录**！应当通过构建脚本只清理前端生成的静态文件（如 `index.html`、`assets/` 子目录、图标等），确保 `app/src/main/assets/shell/` 完好无损。
- **Gradle 自动构建兼容**：
  - `app/build.gradle.kts` 中的 `npmBuild` 任务会在 `./gradlew assembleDebug` / `assembleRelease` 时自动执行 `cd app/frontEnd && npm run build`。请确保 `npm run build` 在 `app/frontEnd` 下能够零报错完成 TypeScript 类型检查、Vite 打包与资源同步。

---

## 6. 真机联调环境与本机安全约束

### 6.1 真机联调地址（USB 连接时）
- **F50 网关 IP**：`192.168.0.1`
- **高级后台 Web（目标服务）**：`http://192.168.0.1:2333`（默认口令 / Token：`admin`）
- **中兴官方后台 Web**：`http://192.168.0.1:8080`（默认密码：`admin`）
- **Root Web 终端 (ttyd)**：`http://192.168.0.1:1146`（默认密码：`admin`）
- **Vite 本地开发代理**：`vite.config.ts` 中默认将 `/api` 代理至 `http://192.168.0.1:2333`，同时建议提供一套完善的本地 Mock 数据回退（当设备未连接时也能在浏览器完整预览和调试所有 UI 状态与交互）。

### 6.2 本机环境安全硬性约束
- **严禁修改本机 Mac 的任何系统网络设置、路由表、DNS、Clash 或 Tailscale 配置**。
- 若 F50 通过 USB 网卡（`en7`）连接，严禁开启 `en7` 的 IPv6（必须保持 `IPv6: Off`）。
