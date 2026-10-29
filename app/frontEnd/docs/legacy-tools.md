# 原版 UFI-TOOLS「工具箱 · 系统 · OTA」功能盘点

> 用途：AirPulse 重写「AT 终端 / 定时任务 / 测速 / 高级工具 / ADB / 系统 / 软件更新」时，照此对接接口、制作 Mock、避开原版的坑。
> 依据：只读分析原版前端快照 `app/frontEnd/legacy-public/`、Kotlin 后端源码、`app/src/main/assets/shell/` 下的脚本、`API_Doc.md`、`User_Doc.md`。**未连接设备、未抓包、未运行任何构建**。
> 范围外：仪表盘、选网、锁频、锁小区、流量（见 `legacy-radio-dashboard.md`）；短信与转发、Wi-Fi 与接入设备、APN、DHCP。请求签名与登录已实现，本文不再展开。

## 阅读约定

**出处缩写**（行号以当前仓库文件为准）

| 缩写 | 实际路径 |
| --- | --- |
| `main.js` / `requests.js` / `utils.js` / `theme.js` | `app/frontEnd/legacy-public/script/*.js` |
| `index.html` / `zh.json` | `app/frontEnd/legacy-public/index.html`、`app/frontEnd/legacy-public/lang/zh.json` |
| `atModule.kt` `adbModule.kt` `advancedToolsModule.kt` `otaModule.kt` `themeModule.kt` `pluginsModule.kt` `scheduledTaskModule.kt` `speedTestModule.kt` `anyProxyModule.kt` `configModule.kt` `baseDeviceInfoModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/**` |
| `KanoUtils.kt` `ShellKano.kt` `RootShell.kt` `KanoRequest.kt` `KanoHttp.kt` `TaskScheduler.kt` `kanoGoformRequest.kt` `DeviceInfo.kt` `KanoLog.kt` `SmbThrottledRunner.kt` | `app/src/main/java/com/minikano/f50_sms/utils/` |
| `ADBService.kt` `WebService.kt` `AppMeta.kt` `SMBConfig.kt` `KanoAuth.kt` | `com/minikano/f50_sms/` 根目录、`configs/`、`modules/auth/` |
| `samba_exec.sh` `login.sh` `ufi_keep_alive.sh` `send_at.go` | `app/src/main/assets/shell/` |
| `build.gradle.kts` | `app/build.gradle.kts` |

**可信度标签**：**【代码】** 前端或后端源码可直接证明（行号指明文件）；**【文档】** 来自 `API_Doc.md` / `User_Doc.md`；**【推断】** 未经证实，需真机核对。

**接口约定**

- goform 读：`GET /api/goform/goform_get_cmd_process?isTest=false&cmd=<…>&multi_data=1&_=<ts>`，下文只写 `cmd=`。
- goform 写：`login()` → `POST /api/goform/goform_set_cmd_process`（`goformId=…&isTest=false&AD=…`，表单编码）→ `logout()`。下文只写 `goformId` 和参数。成功判定为 `result == "success"`。
- UFI 自身的 POST：请求体是 JSON 字符串。后端统一 `receiveText()` 再用 `org.json` 解析，**不检查 Content-Type**。原版的 `fetchWithTimeout` 会把调用方传入的请求头整体覆盖掉（`requests.js:487-509`），所以原版很多 POST 实际是 `text/plain`，对后端没有影响。

---

## 0. 速览：功能 → 接口

| 功能 | 原版入口 | 接口 | 前置条件 | 新版建议 |
| --- | --- | --- | --- | --- |
| 自定义 AT | 功能列表「AT指令」弹窗 | `GET /api/AT?command=&slot=` | 登录 | 保留，加字符过滤与危险指令确认 |
| AT 快捷：签约速率 / IMEI / IMSI / 基带信息 / 重启基带 | 同上 | `/api/AT` | 登录 | 保留，「重启基带」加确认 |
| AT 快捷：强力查串 | 同上 | `POST /api/root_shell`（`imei_reader`） | 高级功能 | 可保留 |
| AT 快捷：填入改串指令 | 同上 | 只填输入框 | — | 不建议保留 |
| VoLTE / VoNR（两卡槽） | 同上 | `GET/POST /api/volte_status`、`/api/vonr_status` | 登录 | 保留，做成开关 |
| 高铁模式 | 同上 | `/api/AT`（`AT+SP5GCMDS`） | 登录 | 保留，修正状态解析 |
| 定时任务 | 功能列表「定时任务」 | `list_tasks` `get_task` `add_task` `remove_task`（`clear_task` 未用） | 登录；goform 动作依赖已保存的官方后台密码 | 保留，动作改成表单化 |
| 定时重启（官方） | 功能列表「定时重启」 | `cmd=restart_schedule_switch,restart_time`；`RESTART_SCHEDULE_SETTING` | 登录 | 保留 |
| 内网测速 | 功能列表「内网测速」 | `GET /api/speedtest?ckSize=&cors` | 登录 | 保留，改为定时长测速 |
| 流量测速 | 功能列表「流量测速」 | `GET /api/proxy/--<url>` | 登录、目标在公网 | 保留，预置测速地址 |
| iperf3 | 无入口 | 后端自启 `iperf3 -s -D`（5201） | — | 只放说明 |
| 高级功能（root 基础设施） | 「高级功能」弹窗 | `GET /api/smbPath?enable=1/0` | 开启时实际依赖无线 ADB | 保留 |
| 高级功能状态 | 同上 | `POST /api/root_shell {"command":"whoami"}` | — | 保留 |
| Samba 文件共享（官方） | 功能列表「文件共享」 | `cmd=samba_switch`；`SAMBA_SETTING` | 登录 | 保留，高级功能开启时锁定 |
| Root Shell | 无通用入口，内部调用 | `POST /api/root_shell` | 高级功能 | 内部使用 |
| User Shell | 无通用入口，内部调用 | `POST /api/user_shell` | — | 内部使用 |
| TTYD 终端 | 主页「TTYD」区块（iframe） | `GET /api/hasTTYD?port=1146`；终端在 `:1146` | 高级功能 | 保留 |
| 开发者菜单 | 连点标题 3 次 | 见 5.6 | 多数要高级功能 | 拆进「高级」页 |
| 端口放行 / 阻止 | 开发者菜单 | `root_shell` 执行 iptables | 高级功能 | 可保留 |
| 调试日志开关 | 开发者菜单 | `POST /api/set_log_status`（`GET /api/get_log_status` 原版未用） | — | 保留 |
| CPU 唤醒锁 | 开发者菜单、高级功能弹窗 | `POST /api/set_wakelock_status`（无读取接口） | — | 保留 |
| one_click_shell | 开发者菜单 | `GET /api/one_click_shell` | 无线 ADB | 不建议保留 |
| 禁用固件更新 | 高级功能弹窗 | root 方式：`root_shell`；否则 `GET /api/disable_fota` | 高级功能或无线 ADB | 保留 |
| 编辑启动脚本 | 高级功能弹窗 | `root_shell` 读 + `upload_img` + `root_shell mv` | 高级功能 | 保留 |
| 提取 Boot | 高级功能弹窗 | `root_shell dd` + 下载 `/api/uploads/boot_x.img` | 高级功能 | 可选 |
| 小核开关 | 无按钮（只有 `window.switchCpuCore`） | `root_shell` | 高级功能 | 不保留 |
| 日志查看 | 无 | 无（可用 shell 读日志文件） | — | 新增 |
| 上传文件管理 / 清空 | 开发者菜单、主题弹窗 | `user_shell ls`、`upload_img`、`delete_img`、`delete_all_uploads_data` | — | 保留 |
| 有线 ADB（USB 调试） | 高级功能弹窗 | `cmd=usb_port_switch`；`USB_PORT_SETTING` | 登录 | 保留 |
| 无线 ADB（开机自启） | 高级功能弹窗 | `GET/POST /api/adb_wifi_setting` | 原版要求高级功能 | 保留 |
| 无线 ADB 就绪状态 | 高级功能 / OTA 弹窗 | `GET /api/adb_alive` | — | 保留 |
| 软件更新（在线） | 「软件更新」弹窗 | `check_update` `download_apk` `download_apk_status` `install_apk` | 外网 | **不做** |
| 软件更新（本地上传） | 新增 | `upload_img` → `download_apk`（`127.0.0.1`）→ `download_apk_status` → `install_apk` | 高级功能或无线 ADB | **新做** |
| 万能代理 | 无独立入口 | `ANY /api/proxy/--<url>` | 目标在公网 | 只用于流量测速 |
| 内网穿透 | 无（靠插件） | 无 | — | 延后 |
| 重启 / 关机 | 功能列表 | `REBOOT_DEVICE` / `SHUTDOWN_DEVICE` | 登录 | 保留 |
| 恢复出厂 | 无 | 无（官方 goformId 待抓包） | — | 暂不做 |
| 修改登录口令 | 「更改口令」 | `POST /api/set_token` | 登录 | 已实现 |
| 修改官方后台密码 | 「更改密码」 | `CHANGE_PASSWORD` + `POST /api/update_admin_pwd` | 登录 | 保留 |
| 版本 / 设备信息 | 标题、各处 | `GET /api/version_info`、`SELinux`、`usb_status`、`connInfo`、`set_nickname` | — | 保留 |
| 自定义注入 | 「插件功能」 | `GET /api/get_custom_head`、`POST /api/set_custom_head` | — | 作为高级功能保留 |
| 后端主题 | 「主题背景」 | `GET /api/get_theme`、`POST /api/set_theme` | — | 不需要 |
| 快捷开关（性能模式、指示灯、NFC、漫游、USB 上网模式、SIM 卡） | 功能列表 | 见 9.10 | 登录 | 保留 |

---

## 1. 通用约定与跨功能的坑

### 1.1 响应格式【代码】

- 成功多为 `{"result":"success"}`。例外：`remove_task` 返回 `{"result":"removed"}`，`download_apk` 返回 `{"result":"download_started"}`，`root_shell` 的 `result` 是字符串，`user_shell` 的 `result` 是 `{done, content}` 对象。
- 失败多为 HTTP 500 + `{"error":"…"}`。例外：
  - `install_apk`、`one_click_shell` 是**流式响应，状态码固定 200**，错误放在 body 的 `error` 字段；
  - `get_task` 缺参 400、不存在 404；`delete_img` 非法文件名 403；
  - `speedtest` 超并发 429，body 是纯文本；`/api/proxy` 的 403 / 502 也是纯文本；
  - 鉴权失败统一 401，body 为空。
- **很多响应（主要是错误响应）是字符串模板拼出来的，内容没有转义**。里面出现 `"` 或换行时，整个响应就不是合法 JSON。涉及 `/api/AT`、`root_shell`、`smbPath`、`disable_fota`、`hasTTYD`、`download_apk`、`download_apk_status` 的 `error` 字段、`upload_img`、`set_custom_head`、`add_task`、`remove_task`、`set_token`、`version_info`（别名含引号时）。新前端的请求层要先 `JSON.parse`，失败时把原始文本当作错误信息显示。
- 类型混用：`adb_wifi_setting` 读取返回布尔，写入回显的 `enabled` 是字符串；`adb_alive` 的 `result` 是字符串 `"true"`；`get_log_status` 是字符串 `"true"`；`volte_status`、`need_token`、`is_weak_token`、`accept_terms` 是布尔。

### 1.2 三种「能力」前置条件

| 能力 | 判定方式 | 依赖它的功能 |
| --- | --- | --- |
| **高级功能**（root） | `POST /api/root_shell {"command":"whoami"}`，`result` 含 `root`（`utils.js:51-59`） | Root Shell、TTYD、端口防火墙、编辑启动脚本、提取 Boot、强力查串、无线 ADB 开关（原版限制）、OTA 极速安装、禁用更新（root 方式） |
| **无线 ADB 就绪** | `GET /api/adb_alive`，`result == "true"`（`requests.js:525-536`） | OTA 非 root 安装、one_click_shell、禁用更新（ADB 方式）、开启高级功能 |
| **官方后台密码已同步**（`ADMIN_PWD`） | 没有直接判定接口；原版每次登录成功都会调用 `POST /api/update_admin_pwd`（`main.js:571-575`） | 定时任务的 goform 动作、无线 ADB 开机自启 |

新版建议在「高级」页顶部用一个状态卡集中显示这三项，各功能按钮按依赖自动禁用并说明原因。

### 1.3 原版通用交互【代码】

- 执行中禁用按钮：`disableButtonWhenExecuteFunc`（`main.js:3502-3514`），设置 `disabled` 和 `opacity: .5`，结束恢复。
- 结果区：AT 弹窗 `#AT_RESULT`、高级功能弹窗 `#AD_RESULT`，直接 `innerHTML` 写入后端返回内容，不转义。
- 确认方式：同一个按钮连点并修改按钮文字，没有确认弹窗，也没有用 `window.confirm`。

---

## 2. AT 指令终端

### 2.1 原版界面【代码】

- 入口：功能列表「AT指令」`#AT`（`index.html:97-98`），登录后可用（`main.js:3392-3407`）。点击时并发触发 `initHighRailBtn()`、`initVoLTESwitchBtn()`、`initVoNRSwitchBtn()`（**一共 5 条 AT**，不等结果），同时打开 `#ATModal`（`index.html:1553-1638`）。
- 弹窗从上到下：
  1. 两条黄色警告：「⚠️警告：执行自定义AT属于高级操作，请务必确保输入准确无误。因执行指令所引发的任何后果，需由您自行承担。」「⚠️提示：AT指令(同网络ADB)生效版本：F50:B09\B24 U30:B17\B19 M3:B07 …（恢复出厂设置能解决99%问题）」（`index.html:1559-1565`、`zh.json:296-297`）；
  2. 「AT执行槽位」原生 `<select id="AT_SLOT">`，只有 `0` / `1` 两项（`index.html:1571-1577`）；
  3. 输入框 `#AT_INPUT`（占位「AT+开头的指令」）和「GO」按钮（`index.html:1580-1587`）；
  4. 「快捷指令」按钮区（`index.html:1589-1626`），见 2.3；
  5. 「执行结果」区 `#AT_RESULT`（`index.html:1628-1632`），点击结果文字复制。
- 自定义指令 `handleATFormSubmit`（`main.js:3410-3441`）：
  - 输入为空 → toast「请输入AT指令」；
  - 结果区先写「执行中,请耐心等待...」；
  - 成功：结果经 `parseCGEQOSRDP()` 格式化后写入（不是 `+CGEQOSRDP` 就原样显示），toast「执行成功」，同时清空 IMEI 缓存；
  - `res.error` 存在：结果区写错误文本，toast「执行失败」。
- 没有输入校验（只判空），没有历史记录，没有危险指令确认。

### 2.2 接口 `GET /api/AT`【代码】

```
GET /api/AT?command=<encodeURIComponent(指令)>&slot=<0|1>
```

- 前端 `executeATCommand(command, slot)`（`main.js:3226-3242`）：`slot` 省略时读 `#AT_SLOT`，不是数字就用 0；使用不带超时的 `fetch`。
- 后端（`atModule.kt:30-80`）：
  - 缺 `command` → 500 `AT指令执行错误：缺少 query 参数 command`；
  - `command.trim()` 不以 `AT` 开头（不区分大小写）→ 500 `AT指令执行错误：解析失败，AT指令需要以 “AT” 开头`；
  - `slot` 不是整数就用 0；任何整数都原样传给 `sendat`（原版只用 0 / 1）；
  - 执行 `<filesDir>/sendat -n <slot> -c '<command.trim()>'`，经 `sh -c`（`atModule.kt:46-47`）；**超时 60 s**（`ShellKano.kt:23`、`:65`）；超时或 stderr 有任何输出时返回 null → 500 `AT指令执行错误：AT 指令没有输出`。
- `sendat`（`send_at.go`）通过 `service call vendor.sprd…` 把指令发给基带，再把返回的 Parcel 十六进制转回文字，**丢掉所有 ASCII < 32 的字符（包括 `\r\n`）**，所以多行响应会被挤成一行。
- 后端规范化（`atModule.kt:50-61`）：
  1. `"` 转义为 `\"`（JSON 解析后还原成 `"`）；
  2. 删除 `\n`、`\r`，去掉开头空白；
  3. 结尾是 `ok`（不区分大小写）时，去掉这两个字符、去掉尾部空白，再拼上 ` OK`（前面带一个空格）；
  4. 开头是 `,` 时去掉（Parcel 的长度字段偶尔会被解析成可打印字符）。

响应示例：

```json
{ "result": "+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK" }
```

- **基带层面的错误不会变成 HTTP 错误**：基带返回 `ERROR` 或 `+CME ERROR: 4` 时，后端照样返回 200 `{"result":"ERROR"}`。原版查询 QCI 时也是用 `result.includes('ERROR')` 判断（`main.js:3294`）。⚠️ 现有 `mock/server.ts:116-121` 把 `ERROR` 做成 500，与真机不一致，建议改成 200。
- 纯 `OK` 的写指令返回 `" OK"`（开头一个空格）【推断】。

### 2.3 原版内置预设（逐条）【代码】

| # | 按钮 | 实际调用 | 用途 | 风险 | 结果显示 | 出处 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 签约速率 | `AT+CGEQOSRDP=1` | 查询 QCI 等级与签约 APN-AMBR | 只读 | 格式化为 `QCI：9 ⬇️ 1000Mbps ⬆️ 200Mbps`（字段 1 为 QCI，字段 6 / 7 为下 / 上行 AMBR，单位 kbps ÷ 1000） | `index.html:1594`；`main.js:3443-3468`、`3212-3223` |
| 2 | IMEI | `AT+CGSN` | 读 IMEI | 只读 | 原文 | `index.html:1596-1598` |
| 3 | 强力查串 | **不是 AT**：`root_shell` 执行 `/data/data/com.minikano.f50_sms/files/imei_reader` | 从 DIAG 通道读 IMEI（AT 读不到时用） | 需要高级功能，否则 toast「需要启用高级功能才可使用」 | 输出 `\n` 换成 `<br>`，加粗 | `index.html:1599-1601`；`main.js:6807-6821` |
| 4 | 填入改串指令 | 只把 `AT+SPIMEI=0,"你的新串号"` 写进输入框，**不执行** | 改写 IMEI | 高危、合规风险；内置卡 / 物联卡可能因此不可用（`User_Doc.md:272`） | — | `index.html:1602-1604`；`utils.js:525-527` |
| 5 | 基带信息 | `AT+CGMR` | 读基带 / 固件版本 | 只读 | 原文 | `index.html:1605-1607` |
| 6 | 重启基带 | `AT+CFUN=1,1` | 重启基带，会断网 | 高危，**原版无确认** | 原文 | `index.html:1608-1610` |
| 7 | IMSI | `AT+CIMI` | 读 IMSI | 只读 | 原文 | `index.html:1611-1613` |
| 8 | VoLTE(slot0) | `GET/POST /api/volte_status`，slot 0；后端执行 `AT+CAVIMS?` / `AT+CAVIMS=<0或1>` | VoLTE 开关 | 中 | 按钮高亮表示开启；toast「操作成功」 | `index.html:1614-1615`；`main.js:3330-3359`、`8080-8099`；`KanoUtils.kt:430-457` |
| 9 | VoNR(slot0) | `GET/POST /api/vonr_status`，slot 0；后端执行 `AT+SP5GCMDS="get nr synch_param",42`（取第 3 个字段）/ `AT+SP5GCMDS="set nr param",45,<0或1>` | VoNR 开关 | 中 | 同上 | `index.html:1616-1617`；`main.js:3361-3390`、`8122-8141`；`KanoUtils.kt:409-453` |
| 10 | VoLTE(slot1) | 同 8，slot 1 | | | | `index.html:1618-1619`；`main.js:8101-8120` |
| 11 | VoNR(slot1) | 同 9，slot 1 | | | | `index.html:1620-1621`；`main.js:8143-8162` |
| 12 | 高铁模式 | 查询 `AT+SP5GCMDS="get nr synch_param",44`；开 `AT+SP5GCMDS="set nr param",35,1`；关 `…,35,0` | NR 高速移动优化 | 中，**重启生效** | 按钮高亮；toast「操作成功！重启生效」 | `index.html:1622-1624`；`main.js:3306-3328`、`7219-7244` |

不在 AT 弹窗里、但原版会自动发送的 AT：`AT+CGEQOSRDP=1`（每 10 s，`main.js:3304`）、锁频后的 `AT+SFUN=5` / `AT+SFUN=4`、`getSupportNrBandList` 内部的 `AT+SP5GCMDS="get nr support_band"`。这三条见 `legacy-radio-dashboard.md`。

**VoLTE / VoNR 接口细节**【代码】（`baseDeviceInfoModule.kt:439-557`）

- 读：`GET /api/volte_status?slot=0` → `{"enabled": true}`（布尔，多行 JSON）。AT 输出解析失败 → 500 `{"error":"获取volte_status信息出错"}`。
- 写：`POST /api/volte_status`，body `{"enabled":"1","slot":0}`。后端用 `optString` 读取（数字也会转成字符串）：`enabled` 不是 `"0"` 都当 1，`slot` 不是 `"0"` 都当 1。AT 输出包含 `OK` → `{"result":"success"}`，否则 500 `{"error":"设置volte状态出错"}`。结果另存到 prefs `volte_status_<slot>`，没有读取用途。
- `vonr_status` 完全同构，错误文案把 volte 换成 vonr。
- 原版每次打开 AT 弹窗都发 4 个读请求，每个都是一条 AT。

**高铁模式状态解析的坑**：原版用 `result.includes('synch_param,44,1')` 判断开启（`main.js:3319`）。而后端解析同类的 VoNR 响应时，是先删掉引号再按逗号取第 3 段（`KanoUtils.kt:409-428`），说明真实响应形如 `+SP5GCMDS: "get nr synch_param",44,1 OK`【推断】。如果带引号，原版的 `includes` 永远不成立，按钮永远显示「关」。新版按 VoNR 的方法解析：删引号 → 取冒号后、`OK` 前的部分 → 按逗号拆分 → 第 3 段为 `1` 即开启。另外 `initHighRailBtn` 的错误分支引用了未定义的 `silent`（`main.js:3316`），会抛 ReferenceError，被外层 catch 吞掉。

### 2.4 危险指令拦截

原版**没有任何拦截**：只有两条静态警告，加上后端「必须以 AT 开头」的校验。「重启基带」和「填入改串指令」都是一键直达。

**必须在前端拒绝的字符**（注入面）【代码】：

| 字符 | 原因 | 出处 |
| --- | --- | --- |
| `'` | 后端用单引号把指令拼进 shell，单引号会截断引用，后面的内容按 shell 命令执行（App 用户权限） | `atModule.kt:46` |
| `$`、`` ` `` | `sendat` 用 Go 的 `strconv.Quote` 把指令放进双引号再 `sh -c`，双引号里的 `$()` 和反引号会被展开 | `send_at.go:109`、`:118` |
| `\r`、`\n` | 查询参数解码后会留在命令里；`sendat` 丢弃控制字符，属于无效输入 | — |

正常 AT 指令（含 `+ = ? , "`）不受影响。

**建议的确认规则**【推断】：

- 只读，直接执行：以 `?` 或 `=?` 结尾；或在白名单内（`AT+CGSN`、`AT+CIMI`、`AT+CGMR`、`AT+CSQ`、`AT+CGEQOSRDP=1`、`AT+SP5GCMDS="get …`）。
- 写入，普通确认：含 `=` 且不以 `?` 结尾。
- 高危，红色确认并写明后果：`AT+CFUN`（`=0` / `=4` 断网，`=1,1` 重启基带）、`AT+SFUN`、`AT+SPIMEI` / `AT+EGMR`（改串）、`AT+SP5GCMDS="set`、`AT+CGDCONT=`、`AT+COPS=`。
- 不保留「填入改串指令」按钮。

### 2.5 其它坑

- 结果用 `innerHTML` 写入，存在注入风险；新版按纯文本渲染（等宽字体、保留原文）。
- `handleATFormSubmit` 对所有输出都套 `parseCGEQOSRDP`，只是碰巧对非 QCI 输出原样返回。新版：只在指令是 `AT+CGEQOSRDP` 时额外显示解析结果，原文始终保留。
- 槽位下拉只有 0 / 1；双卡机型的 `sim_slot` 与 AT 槽位映射见 `legacy-radio-dashboard.md` §2.5。新版默认用当前卡对应的槽位。
- 打开弹窗就发 5 条 AT；基带忙时会拖慢页面。新版：打开 AT 页只读 VoLTE / VoNR / 高铁模式的状态，**串行**发送。
- 每执行一次 AT 都会清空 IMEI 缓存（`main.js:3429`、`3487`）。
- 后端超时 60 s，前端无超时。新版前端设 65 s 超时，并把所有 AT 请求排成一个队列，同一时刻只发一条（并发调用同一 binder 可能互相阻塞【推断】）。

### 2.6 新版实现要点

1. 输入框做前缀补全（自动补 `AT`），回车执行，保留最近 20 条历史（本地存储）。
2. 发送前做 2.4 的字符过滤和确认分级。
3. 结果区显示「指令 / 槽位 / 耗时 / 原始输出」，`ERROR`、`+CME ERROR` 标红（HTTP 仍是 200）。
4. 快捷指令分组：只读查询（签约速率、IMEI、IMSI、基带信息）、开关（VoLTE ×2、VoNR ×2、高铁模式）、危险（重启基带）。

---

## 3. 定时任务

### 3.1 原版界面【代码】

- 入口「定时任务」（登录后可用，`main.js:5351-5364`）→ `#ScheduledTasksModal`（`index.html:1140-1162`）：说明文字（`scheduled_tasks_info`，`zh.json:726`）、「刷新」「添加任务」按钮、任务列表。
- 列表项（`appendTaskToList`，`main.js:5366-5437`）：
  - 任务名称（即 `id`）、触发时间；
  - 上次执行：有 `lastRunTimestamp` 时用 `toLocaleString('zh-cn')` 显示，否则「暂未执行」；`hasTriggered` 为真时追加「（执行过）」；
  - 重复执行：是 / 否；
  - 动作参数：一个禁用的文本框，内容是 `JSON.stringify(actionMap, null, 2)`；
  - 「编辑」「删除」按钮。
- 排序：后端按 `key` 升序返回，前端 `reverse()`，所以最新创建或编辑过的任务在最前（`main.js:5455`）。
- 删除：1 s 内点两次（第一次按钮文字变「确认？」）→ `remove_task`，返回 `result === 'removed'` 时 toast「删除成功」并刷新（`main.js:5401-5434`）。
- 添加 / 编辑弹窗 `#AddTaskModal`（`index.html:1164-1236`）：
  - 「任务名称」`name="id"`，必填；新建可编辑，编辑时禁用；
  - 「触发时间」原生 `<input type="time">`，值为 `HH:mm`，必填；
  - 「重复执行」原生复选框，**新建时默认不勾选**，即一次性任务（`main.js:5339`）；
  - 「动作参数（JSON）」文本框；
  - 26 个预设按钮，点击把模板 JSON 写进文本框（见 3.4）；
  - 提交（`main.js:5471-5519`）：动作为空时用 `{}`；不是合法 JSON → toast「动作参数必须是合法 JSON」；成功 → toast「保存成功」，回到列表并刷新；返回值不是 `success` → 「添加失败」；网络错误 →「网络异常」。
- 编辑（`main.js:5530-5555`）：先关闭列表弹窗 → `GET /api/get_task?id=` 回填表单（id 禁用）→ 提交仍然调用 `add_task`，同 id 覆盖。

### 3.2 接口【代码】（`scheduledTaskModule.kt`）

| 方法 | 路径 | 请求 | 成功 | 失败 |
| --- | --- | --- | --- | --- |
| GET | `/api/list_tasks` | — | `{"tasks":[TaskInfo…]}`，按 `key` 升序 | 500 `{"error":"获取任务列表失败"}` |
| GET | `/api/get_task?id=<id>` | query `id` | 单个 TaskInfo | 400 `{"error":"缺少任务ID"}`；404 `{"error":"任务不存在"}`；500 `{"error":"获取任务失败"}` |
| POST | `/api/add_task` | JSON，见 3.3 | `{"result":"success"}` | 500 `{"error":"添加任务失败: <原因>"}` |
| POST | `/api/remove_task` | `{"id":"…"}` | `{"result":"removed"}`（id 不存在也一样） | 500 `{"error":"删除任务失败: 参数id不能为空"}` |
| POST | `/api/clear_task` | 无 | `{"result":"success"}` | 500 `{"error":"清空定时任务出错: 任务调度器未初始化"}` |

原版没有使用 `clear_task`。

**TaskInfo**（`scheduledTaskModule.kt:21-30`）：

```ts
interface TaskInfo {
  key: number                          // 创建或最后一次保存时的毫秒时间戳，编辑会刷新
  id: string
  time: string                         // 规范化后的 "HH:mm"
  repeatDaily: boolean
  actionMap?: Record<string, string>   // 为空对象时字段缺失
  lastRunTimestamp?: number            // 从未触发时字段缺失
  hasTriggered?: boolean               // 为 false 时字段缺失
}
```

⚠️ 后端用 kotlinx 默认的 `Json` 编码（`encodeDefaults = false`），**值等于默认值的字段不会出现在响应里**【代码 + 推断（框架默认行为）】。所以「从未执行」的任务没有 `lastRunTimestamp` 和 `hasTriggered` 两个字段，类型要写成可选。

### 3.3 `add_task` 字段与取值【代码】

```json
{ "id": "每日重启", "time": "03:00", "repeatDaily": true, "action": { "goformId": "REBOOT_DEVICE" } }
```

| 字段 | 必填 | 规则 | 出处 |
| --- | --- | --- | --- |
| `id` | 是 | trim 后不能为空；任意字符串（原版直接用中文名称）；同 id 覆盖，`key`、`hasTriggered`、`lastRunTimestamp` 一并重置 | `scheduledTaskModule.kt:44`、`:57`；`TaskScheduler.kt:191-198` |
| `time` | 是 | trim；`\d{2}:\d{2}:\d{2}` 截取前 5 位；`\d{2}:\d{2}` 原样保存；**其它格式也会原样保存，但永远不会触发**，因为触发时用字符串比较 `task.time == 当前 "HH:mm"`。代码注释里说的 `yyyy-MM-dd HH:mm:ss` 没有实现 | `TaskScheduler.kt:182-189`、`:156` |
| `repeatDaily` | 否 | `optBoolean`，默认 `true`；字符串 `"true"` / `"false"` 也能识别 | `scheduledTaskModule.kt:46` |
| `action` | 是 | 必须是 JSON 对象，缺失 → `添加任务失败: 请传入action`；所有值经 `optString` 转成字符串（数字 `0` → `"0"`，嵌套对象 → JSON 文本） | `scheduledTaskModule.kt:47-55` |

**动作的两种语义**（`TaskScheduler.kt:238-307`）：

1. **转发设备信息**：`action` 里有键 `kano_do_sms_forward_action`，并且**任意一个值**等于 `"1"`（实现写的是 `containsValue("1")`）→ 如果短信转发总开关打开（prefs `kano_sms_forward_enabled != "0"`），按当前渠道（SMTP / CURL / 钉钉）推送一条消息，来源和正文都是任务 id，是否附带设备状态取决于该渠道的「同时转发设备信息」设置。
2. **官方后台动作**：其它情况下，整个 `action` 作为官方 goform 表单，发到 `http://<gateway_ip 的主机部分>:8080/goform/goform_set_cmd_process`。流程是自动 `LOGIN`（旧登录方式，密码用 prefs 里的 `ADMIN_PWD`，没有时用 `Wa@9w+YWRtaW4=`）→ 追加 `isTest=false&AD=<签名>` 提交 → `LOGOUT`（`kanoGoformRequest.kt:19-113`）。多个任务串行执行（互斥锁），每个之后等 1 s。结果只写日志。

触发时间按**设备本地时区**。

### 3.4 原版预设动作（逐条）【代码】（`fillAction`，`main.js:5564-5779`）

| 按钮 | 写入文本框的模板 | 说明 |
| --- | --- | --- |
| 转发设备信息 | `{"kano_do_sms_forward_action":"1"}` | 点按钮时先 `GET /api/sms_forward_enabled`，`enabled` 不是 `"1"` 就提示「转发设备信息功能依赖短信转发功能 / 短信转发未启用，请先在“短信转发”页面启用并配置后再使用。」并且不写入（`main.js:5729-5743`） |
| 发送短信 | `{"goformId":"SEND_SMS","Number":"<号码>","MessageBody":"<gsmEncode(内容)>"}` | 弹出小窗输入号码和内容；文本框里已有此模板时用 `gsmDecode` 回填；号码 `parseInt` 失败提示「请输入合法手机号」，内容为空提示「短信内容不能为空」；`MessageBody` 是 UTF-16BE 十六进制（`main.js:5682-5727`） |
| 指示灯 | `{"goformId":"INDICATOR_LIGHT_SETTING","indicator_light_switch":"此处 开启填 1 关闭填 0"}` | 需要用户手动改值 |
| NFC | `{"goformId":"WIFI_NFC_SET","web_wifi_nfc_switch":"此处 开启填 1 关闭填 0"}` | 同上 |
| 文件共享 | `{"goformId":"SAMBA_SETTING","samba_switch":"此处 开启填 1 关闭填 0"}` | 同上；高级功能开启时不应关闭 |
| 网络漫游 | `{"goformId":"SET_CONNECTION_MODE","ConnectionMode":"auto_dial","roam_setting_option":"此处 开启填 on 关闭填 off","dial_roam_setting_option":"此处 开启填 on 关闭填 off"}` | 同上 |
| 性能模式 | `{"goformId":"PERFORMANCE_MODE","performance_mode":"此处 开启填 1 关闭填 0"}` | ⚠️ goformId 写错了：快捷开关用的是 `PERFORMANCE_MODE_SETTING`（`main.js:1231-1234` 对比 `5594-5597`），这条模板大概率执行失败【推断】 |
| USB调试 | `{"goformId":"USB_PORT_SETTING","usb_port_switch":"此处 开启填 1 关闭填 0"}` | 即有线 ADB |
| 打开数据 | `{"goformId":"CONNECT_NETWORK"}` | |
| 关闭数据 | `{"goformId":"DISCONNECT_NETWORK"}` | |
| 关闭WIFI | `{"goformId":"switchWiFiModule","SwitchOption":0}` | 数字会被后端转成 `"0"` |
| 开启WIFI(5G) | `{"goformId":"switchWiFiChip","ChipEnum":"chip2","GuestEnable":0}` | |
| 开启WIFI(2.4G) | `{"goformId":"switchWiFiChip","ChipEnum":"chip1","GuestEnable":0}` | |
| 5G/4G/3G | `{"goformId":"SET_BEARER_PREFERENCE","BearerPreference":"WL_AND_5G"}` | |
| 5G NSA | 同上，`LTE_AND_5G` | |
| 5G SA | 同上，`Only_5G` | |
| 仅4G | 同上，`Only_LTE` | |
| 关机(仅U30/M3) | `{"goformId":"SHUTDOWN_DEVICE"}` | |
| 重启 | `{"goformId":"REBOOT_DEVICE"}` | |
| 解锁基站 | `{"goformId":"UNLOCK_ALL_CELL"}` | |
| 锁基站 | `{"goformId":"CELL_LOCK","pci":"912","earfcn":"504990","rat":"此处 锁5G填:16 锁4G填:12"}` | pci / earfcn 是示例值，需要用户改（`User_Doc.md:1901-1925`） |
| 切SIM卡1 / 切SIM卡2 | `{"goformId":"SET_SIM_SLOT","sim_slot":0}` / `1` | |
| 切移动 / 切电信 / 切联通 / 切外置 | `sim_slot` 分别为 `0` / `1` / `2` / `11` | V50 机型 |

⚠️ 模板里的中文占位（如「此处 开启填 1 关闭填 0」）如果不改就提交，后端会原样发给官方后台，固件拒绝或产生未知行为。原版完全靠用户自己改（`User_Doc.md:1901-1903`）。新版应把每个动作做成表单（开关、下拉、号码与内容输入框），由前端生成 `action`，不让用户手写 JSON。

### 3.5 调度语义【代码】（`TaskScheduler.kt`）

- 每次增删改后重新计算「下一个要触发的分钟」，延时到那一分钟的 0 秒执行；另外每 5 分钟兜底重算一次（`:119-128`）。
- 触发时执行所有 `time == 当前 "HH:mm"` 且 `!hasTriggered` 的任务，记录 `lastRunTimestamp`，置 `hasTriggered = true` 并持久化（`:148-166`）。
- 每天第一次重算时，把所有每日重复任务的 `hasTriggered` 清零（`:75-84`、`:130-136`）。
- 一次性任务触发后**不会被删除**，一直留在列表里（`hasTriggered = true`，不再参与调度）。设置的时间今天已经过了，就在明天触发。
- 持久化在 prefs `kano_scheduled_tasks`，服务重启后自动恢复。
- **`ADMIN_PWD` 和网关 IP 是在 `restoreTasks()` 时被捕获的**（`:229-230`）。之后修改官方后台密码，不会立刻影响已加载的任务，要等下一次 `add_task` 或服务重启。
- 不记录执行成功与否；没有「立即执行」接口。

### 3.6 启停

后端没有启停字段，原版也没有启停界面。新版如果要做「暂停」，只能在前端本地保存任务内容后调用 `remove_task`，恢复时再 `add_task`【推断】。否则不提供启停。

### 3.7 坑

- 新建默认是一次性任务（复选框默认不勾），用户容易以为会每天执行。新版默认改为「每天」。
- 时间格式稍有不同（例如 `3:00`）就永远不触发，而且没有报错。新版前端保证输出两位数的 `HH:mm`。
- 性能模式模板的 goformId 错误；占位文字会被当作真实值提交。
- 编辑会重置执行记录，并把任务挪到列表最前。
- 关闭无线 ADB 会删除 `ADMIN_PWD`（见 6.2），直接在官方后台改密码也会让两边不一致（`zh.json:860`），这两种情况都会让 goform 任务登录失败。
- 设备时区和浏览器时区可能不同（远程访问时），原版不提示。新版在时间选择器旁写明「按设备时间」。
- 同一分钟的多个 goform 任务串行执行，各自独立登录、登出。

### 3.8 对比：官方「定时重启」【代码】

功能列表「定时重启」是中兴固件自带的功能，与上面的任务调度无关（`main.js:2976-3046`、`index.html:1438-1463`）：

- 读：`cmd=restart_schedule_switch,restart_time`；启用时按钮高亮。
- 写：`RESTART_SCHEDULE_SETTING`，`restart_schedule_switch=<0|1>`，`restart_time=<时:分>`。
- 时间校验正则 `^(0?[0-9]|1[0-9]|2[0-3]):(0?[0-9]|[1-5][0-9])$`，允许 `3:5` 这种不补零的写法；不通过时 toast「请输入正确的重启时间 (00:00-23:59)」。新版统一补零为 `HH:mm`。
- 成功 toast「设置成功」并关闭弹窗；失败「设置失败」。

---

## 4. 测速

### 4.1 内网测速（设备 → 浏览器）【代码】

**原版界面**（`index.html:1794-1814`）：功能列表「内网测速」（未登录也能打开，点开始时才检查登录）。块大小输入框 `#ckSize`，标签「块大小(8MB 最大 1024)」，**默认 1024（即 8 GiB）**；结果区；「开始测速」（运行中变成「停止测速」）、「循环测速」、「关闭」。

**接口** `GET /api/speedtest?ckSize=<n>&cors`（`speedTestModule.kt:26-71`）：

- 响应 `application/octet-stream`，内容是服务启动时生成的一块 8 MiB 随机数据，重复 `n` 次；
- 响应头：`Content-Length = n × 8388608`、`Content-Disposition: attachment; filename=random.dat`、`Cache-Control: no-store`、`Pragma: no-cache`；
- `ckSize`（`KanoUtils.kt:367-378`）：不是整数或 ≤ 0 → 4；大于 1024 → 1024；
- 带 `cors` 参数时加 `Access-Control-Allow-Origin: *`（同源访问用不到）；
- 同时最多 3 个测速连接，超出立即返回 429，body 是纯文本「测速请求过多，请稍后再试」；
- 需要签名（不在白名单）。

**原版计算**（`startTest`，`main.js:3886-4071`）：

1. `fetch(url)`，用 `res.body.getReader()` 流式读取；从拿到响应那一刻开始计时；
2. 每隔 ≥ 50 ms 采样一次：`速度 = Δ字节 × 8 / 1024 / 1024 / Δ秒`，保留最近 5 个样本，取平均作为「当前速度」，用 `requestAnimationFrame` 刷新；
3. 读完后：`平均速度 = 总字节 × 8 / 1024 / 1024 / 总秒数`；
4. 显示「下载总量 xx MB / 当前速度 xx Mbps」，结束追加「✅ 测试完成 / 总耗时 xx 秒 / 平均速度 xx Mbps」；
5. 运行中再点按钮 → `AbortController.abort()`，结果区追加「⚠️ 测速已终止」；
6. 其它错误：「❌ 测速失败: <message>」。

**循环测速**（`main.js:4073-4099`）：每 10 ms 检查一次，开始按钮文字是「开始测速」时就自动 `click()`，即一轮结束马上开始下一轮；再点一次停止。

**坑**：

- 单位：用 1024² 换算却标 Mbps，实际是 Mibit/s，比标准 Mbps 小约 4.6%。新版统一用 `bit / 1e6`。
- 默认 8 GiB，基本都要手动停止。新版建议按时长测（例如 10 s 到时 abort，`ckSize` 取 64 即 512 MiB 足够）。
- 只测下行（设备发、浏览器收），还受浏览器和设备 CPU 影响，**不消耗运营商流量**（`User_Doc.md:1175`）。
- 页面里有两个 `id="startSpeedBtn"`（内网测速和流量测速各一个），循环测速依赖 `querySelector` 取到第一个（`main.js:4080`）。
- 结果用 `innerHTML` 拼接。

### 4.2 流量测速（蜂窝下行，经设备代理）【代码】

**原版界面**（`index.html:1815-1845`）：功能列表「流量测速」（需登录）。提示「测速经过内网代理转发，数据仅供参考, 由于代理API限制，下载时间每次只维持30秒」（`zh.json:626`）。「测速地址」原生文本框，**没有默认值**，`onchange` 时存到 localStorage `cellularTestUrl`；「线程数量」滑块 1–5，默认 1；按钮同内网测速。

**原版做法**（`main.js:6182-6408`）：

1. 地址为空 → toast「请输入测速地址」；
2. 每个线程 `fetch('/api/proxy/--' + url + '?t=' + Math.random(), { cache: 'no-store' })`，流式读取并累加字节数（线程按 8 个一批发起，实际最多 5 个，这个分批没有作用）；
3. 每 100 ms 计算一次 `Δ字节 × 8 / 1024 / 1024 / Δ秒`（不做平滑），显示「线程数量 / 当前速度 / 下载总量」；
4. 2 s 内一个字节都没收到 → 追加「⚠ 服务器响应较慢」；
5. 全部线程结束 → 追加「平均速度 = 本轮字节 × 8 / 1024 / 1024 / 本轮秒数」；本轮 0 字节 →「测速失败：无有效数据」；
6. 循环模式：每轮结束 500 ms 后自动开始下一轮，期间禁用开始按钮；关闭弹窗即停止。

**后端限制**（`anyProxyModule.kt`，详见 8.1）：连接 10 s、读 8 s、**总时长 30 s**，所以每轮最多 30 s，到时连接被截断；目标域名解析到私网、环回、链路本地地址一律 403；`ufi.ztedevice.com` 被禁止。

**可选服务器**：原版**没有预置任何测速地址**，完全由用户填写。

**坑**：

- 地址里已经有 `?` 时，再拼 `?t=` 会把随机数拼进最后一个参数的值里。新版按 URL 是否已有查询串选择 `?` 或 `&`。
- 会消耗蜂窝流量，原版没有提示。
- 只测下行；单位问题同 4.1；多个线程共享一个全局 `totalBytes` 变量。

**新版建议**：预置几个公网大文件测速地址（允许编辑），醒目提示「会消耗流量」，单轮固定 ≤ 25 s，统一单位。

### 4.3 iperf3【代码】

- 后端服务启动时自动运行 `iperf3 -s -D`（App 用户权限，默认端口 5201；`ADBService.kt:315-335`）。**原版前端没有任何入口**。
- 用法【推断】：局域网电脑执行 `iperf3 -c 192.168.0.1`（加 `-R` 测反向）。高级功能开启后，IPv6 下的 5201 端口被 DROP（`samba_exec.sh:340-355`）。
- 新版：在测速页放一段使用说明即可，不需要接口。

### 4.4 原版没有的

没有 Speedtest.net 类的测速服务器选择、没有上传测速、没有延迟测试。

---

## 5. 高级工具

### 5.1 「高级功能」（`GET /api/smbPath`）

**原理**【代码】：

- 后端写一份 `smb.conf`，其中 `root preexec = /system/bin/sh <filesDir>/samba_exec.sh`（`SMBConfig.kt:10-24`），再拷到 `/data/samba/etc/smb.conf`。之后 App 每 30 s 用 jcifs 访问一次 `smb://<网关>/internal_storage/`（`ADBService.kt:303-313`），让 Samba 以 root 身份执行 `samba_exec.sh`。
- `samba_exec.sh` 在开机窗口（运行时间 < 120 s）内执行 `boot_up_script`，其余时间执行 `schedule_script`：
  - 拉起 TTYD：`ttyd --writable --port 1146 login.sh`，**端口写死 1146**（`samba_exec.sh:206-216`）；
  - 拉起 root shell：`socat UNIX-LISTEN:<filesDir>/kano_root_shell.sock,fork,reuseaddr,unlink-early EXEC:/system/bin/sh`（`:218-229`）；
  - 执行用户脚本：开机执行 `/sdcard/ufi_tools_boot.sh`，每次执行 `/sdcard/ufi_tools_schedule.sh`（约 30 s 一次）；
  - IPv6 下 DROP 8080 / 1146 / 139 / 445 / 5555 / 5201 / 5001 / 5002（TCP 和 UDP，`:340-355`），并 `iptables -I INPUT 1 -i lo -j ACCEPT`（`:356`）；
  - 禁用 FOTA、授予权限、挂载 Samba 目录、`chattr +i` 锁定 `smb.conf`、清理限速规则、启动保活守护 `ufi_keep_alive.sh`（每 30 s 检查 App 进程）；
  - 写恢复脚本 `/sdcard/unlock_samba.sh` 和 `/cache/unlock_samba.sh`（`:358-359`）；日志写 `/sdcard/smb_log.log`，超过 4 MB 清空。

**开启**（原版 `handleSambaPath('1')`，`main.js:3558-3598`）：

1. 结果区写「执行中,请耐心等待...」；
2. 先登录官方后台发 `SAMBA_SETTING samba_switch=1`，确保 Samba 打开（失败不提示）；
3. `GET /api/smbPath?enable=1`（不设超时）；
4. 成功：`{"result":"执行成功，等待1-2分钟即可生效！<br>Execution successful, please wait 1–2 minutes for it to take effect!"}`，结果区原样 `innerHTML` 显示，toast「执行完成」；
5. 失败：500 `{"error":"Error：<原因>"}`（注意是全角冒号），toast「执行失败」。

**后端判定**（`advancedToolsModule.kt:37-154`）：

- 先以 App 身份执行 `cat <smb.conf> > /data/samba/etc/smb.conf`（3 s 超时）；无线 ADB 就绪时，再通过 `adb -s localhost shell` 执行一遍。
- 两种方式都失败 → `开启高级功能失败(Adb与Shell方式执行不成功)，请打开网络ADB后再试<br>…`（ADB 未就绪）/ `…，请恢复出厂后，重新安装再试<br>…`（ADB 已就绪）。
- 写完后 `grep` 不到 `samba_exec.sh` → `开启高级功能失败(配置文件没有更改或不存在)，请打开网络ADB后再试<br>…` / `…，请将设备恢复出厂设置后，重新安装再试<br>…`。
- 最后触发一次 Samba 访问。
- 结论：App 身份通常没有权限写 `/data/samba`，**开启高级功能实际上依赖无线 ADB 就绪**【推断】。

**关闭**（`handleSambaPath('0')` → `GET /api/smbPath?enable=0`）：

- 需要 root socket 已经存在，否则 500 `Error：执行命令失败，没有找到 socat 创建的 sock (高级功能是否开启？)<br>…`；
- 通过 root shell 解锁并删除 `smb.conf`、结束保活守护；成功返回 `{"result":"执行成功<br>Execution successful！"}`；按钮文字「移除高级功能(重启生效)」。
- 故障恢复：在 TTYD 执行 `sh /sdcard/unlock_samba.sh` 后重启（`index.html:1658-1661`、`User_Doc.md:2062-2067`）。

**状态检测**（`socatAlive`，`main.js:3516-3529`）：

- 判定方法：`root_shell whoami` 的输出含 `root`；
- 高级功能弹窗和 OTA 弹窗里的 `.socat_status` 行显示「高级功能：🟢 已开启」或「高级功能：🔴 未开启」；
- 高级功能弹窗打开期间**每 1 s 查一次**（`main.js:3547`），关闭弹窗停止；页面加载时也查一次；
- 已开启时**隐藏主界面的「文件共享」按钮**（`main.js:3520`），防止误关 Samba 导致高级功能失效。

**坑**：

- 返回文案里有 `<br>` 和中英双语，新版取 `split('<br>')[0]` 或去掉标签。
- 开启接口返回成功，只代表 `smb.conf` 写进去了；root 真正可用要等 30 s 到 2 min。新版在成功后每 3 s 查一次 `whoami`，最长 3 min，并显示进度。
- 关闭后 `smb.conf` 被删除，但 TTYD 和 socat 进程会一直运行到重启【推断】。
- 开启后如果在官方后台或定时任务里关掉 Samba，高级功能会失效。后端有两道补救：每 30 s 的 Samba 访问失败时，会尝试通过 adb 或残留的 root socket 执行 `settings put global samba_enable 1` 重新打开（`SmbThrottledRunner.kt:90-103`、`ShellKano.kt:760-790`）；开了无线 ADB 自启时，开机流程在高级功能不可用的情况下也会登录官方后台重新打开 Samba（`ShellKano.kt:701-732`）。`User_Doc.md:1530` 说「下次开机时自动开启」，实际依赖这两个条件。

### 5.2 Samba 文件共享开关（官方）【代码】

与 5.1 不是一回事：这是中兴固件自带的 SMB 共享开关。

- 读 `cmd=samba_switch`（`"0"` / `"1"`）；写 `SAMBA_SETTING samba_switch=<0|1>`（`main.js:1517-1556`）；成功 toast「操作成功」；无确认。
- 高级功能开启时原版隐藏这个按钮。新版改成禁用并说明「已被高级功能占用」，或在关闭时强确认。
- 高级功能开启后的共享内容（`SMBConfig.kt:26-56`）：`/data/SAMBA_SHARE`（下挂机内存储、外部存储、SD 卡），以及 `internal_storage`（`/sdcard/DCIM`）、`外置存储`（`/mnt/media_rw`）、`SD卡`（`/storage/sdcard0`），全部允许访客读写。

### 5.3 Root Shell（`POST /api/root_shell`）【代码】

请求 body：`{"command":"<命令>","timeout":10000}`

- `command`：trim 后不能为空。
- `timeout`：毫秒，缺省 100000，超过 100000 按 100000 处理（`advancedToolsModule.kt:383-390`）。**它是 socket 的读超时（每次读一行的等待上限），不是命令的总时长**（`RootShell.kt:21`），持续有输出的命令可以跑得更久。
- 原版前端 `runShellWithRoot(cmd, timeout = 10000)` 把同一个值同时用作 fetch 超时（`requests.js:567-583`）。

执行过程（`RootShell.kt:13-69`）：连接 `<filesDir>/kano_root_shell.sock`（socat 每个连接 fork 一个 root 身份的 `/system/bin/sh`），写入命令，再写入 `printf '%s\n' '<随机结束标记>'`，读到标记为止。

成功响应——**`result` 是字符串，不是对象**：

```json
{ "result": "root" }
```

⚠️ `API_Doc.md` §2 和 §3.5 写的 `{"result":{"done":true,"content":"..."}}` 是错的，那是 `user_shell` 的格式。原版所有调用都把它当字符串用（`utils.js:53-55`、`main.js:847`）。

- 输出去掉尾部空白，行之间用 `\n` 分隔。
- **只返回 stdout**：socat 的 `EXEC` 默认不转发子进程的 stderr【推断】，要看错误信息需要在命令里加 `2>&1`。
- 交互式或常驻的命令会一直卡到超时；命令中的 `exit` 会提前结束，返回已有输出。

错误（500）：

| 响应 | 原因 |
| --- | --- |
| `{"error":"shell执行出错: 命令不能为空"}` | 空命令 |
| `{"error":"shell执行出错: 执行命令失败，没有找到 socat 创建的 sock (高级功能是否开启？)"}` | 高级功能未开启 |
| `{"error":"shell执行出错: 请检查命令输入格式"}` | socket 连接或读写异常，**包括读超时** |
| `{"error":"shell执行出错: 解析请求的json出错"}` | body 不是 JSON |

错误文本没有转义（`advancedToolsModule.kt:428`）。

原版用途：高级功能检测、强力查串、禁用更新、提取 Boot、编辑启动脚本、端口防火墙、IMEI 回填。原版**没有**给用户的通用 root 命令输入框（需要时用 TTYD）。

### 5.4 User Shell（`POST /api/user_shell`）【代码】

请求 body：`{"command":"…"}`，没有 timeout 参数。

- 以 App 身份 `sh -c` 执行，**固定超时 300 s**（`KanoUtils.kt:736-784`）；不需要高级功能。

成功响应：

```json
{ "result": { "done": true, "content": "<stdout，已 trim>" } }
```

- **只要 stderr 有任何输出就算失败**（`KanoUtils.kt:775-779`），返回 500 `{"error":"shell执行出错: <stderr 全文>"}`，即使退出码是 0。需要容忍 stderr 时在命令里加 `2>/dev/null` 或 `2>&1`。
- 超时 → 500 `{"error":"shell执行出错: Error: Command timed out after 300 seconds"}`。
- 错误用 `JSONObject.quote` 转义过，是合法 JSON。

原版用途：上传文件管理里的 `ls`、上传后重命名用的 `mv`。

### 5.5 TTYD Web 终端

**服务**【代码】：由高级功能脚本拉起 `ttyd --writable --port 1146 login.sh`，端口写死 1146。登录脚本（`login.sh:8-57`）：

- 提示 `Password:`，要求输入 **UFI-TOOLS 登录口令**，回显关闭；
- 比较 `SHA256(输入)` 与 prefs 里的 `login_token`；口令文件缺失时用备用口令 `Wa@9w+YWRtaW4=`；
- **错 3 次断开**；成功后 `exec /system/bin/sh`（root，因为是 Samba 的 root 进程拉起的）。

**探测接口** `GET /api/hasTTYD?port=1146`（`advancedToolsModule.kt:178-205`）：

```json
{ "code": "200", "ip": "192.168.0.1:1146" }
```

- 后端对 `http://<gateway_ip 的主机部分>:<port>` 发一次 GET（连接、读取各 1.5 s，不跟随重定向，`KanoUtils.kt:678-696`）；`code` 是状态码的字符串形式，请求失败为 `"-1"`；
- 缺 `port` → 500 `{"error":"获取TTYD信息出错:query 缺少 port 参数"}`。

**原版界面**（`main.js:3113-3146`、`index.html:260-272`）：

- 主页有一个可折叠的「TTYD」区块，默认隐藏；
- 页面加载时读 `localStorage.ttyd_port`（首次访问会自动写入 1146，`main.js:89-91`），探测结果为 `"200"` 才显示区块，600 ms 后嵌入 `<iframe src="http://<res.ip>">`（高 400 px、透明度 .6）；不是 200 就隐藏；
- 只在页面加载时探测一次。
- 开发者菜单里可以改端口（1–65535，存 localStorage 后重新探测，`main.js:3166-3178`），「重置TTYD端口」恢复 1146（`main.js:7147-7154`）。⚠️ 这只改前端探测用的端口，TTYD 实际端口固定是 1146。

**坑**：

- iframe 用的是后端的 `gateway_ip`（通常 192.168.0.1）。**通过 Tailscale、EasyTier、反向代理远程访问时打不开**。新版用 `location.hostname` 拼地址，并提供「在新标签页打开」。
- 「禁用TTYD端口」只是加一条 iptables DROP（见 5.6），但 `hasTTYD` 是设备访问自己，走 `lo` 接口（被 `-i lo -j ACCEPT` 放行），所以探测仍然返回 200，浏览器的 iframe 却连不上【推断】。
- 高级功能没开就没有 TTYD，原版直接隐藏区块，不解释原因。新版显示「需要先开启高级功能」。
- 纯 HTTP 下同为 http，没有混合内容问题；如果新前端将来走 https，iframe 会被浏览器拦截。

### 5.6 开发者菜单（`#TTYDModal`）

**入口**：**2 s 内连点标题「UFI-TOOLS」3 次**（`enableTTYD`，`main.js:3149-3164`；`index.html:52`）。打开时读一次资源服务器地址（`main.js:3198-3210`）。界面在 `index.html:1465-1550`，顶部提示「有些特性需要开启高级功能才能使用」。

| 控件 | 行为 | 接口 | 前置 | 出处 |
| --- | --- | --- | --- | --- |
| 开机自动应用（复选框） | 端口规则同时写进 `/sdcard/ufi_tools_boot.sh` | `root_shell` | 高级功能 | `main.js:7035-7044` |
| 也应用到ipv6（复选框） | 规则同时用 `ip6tables` 执行 | `root_shell` | 高级功能 | — |
| 端口输入框 + 放行 / 阻止 | `togglePort(端口)` | `root_shell` | 高级功能 | `main.js:7207-7217` |
| 启用 / 禁用TTYD端口 | `togglePort(1146)` | `root_shell` | 高级功能 | `main.js:7095-7102` |
| 启用 / 禁用无线ADB端口 | `togglePort(5555)` | `root_shell` | 高级功能 | `main.js:7104-7111` |
| 启用 / 禁用Log | `POST /api/set_log_status {"debug_log_enabled":true/false}` | — | — | `main.js:7113-7128` |
| 启用 / 禁用唤醒锁 | `POST /api/set_wakelock_status {"wakelock_enabled":true/false}` | — | — | `main.js:7130-7145` |
| one_click_shell.sh | `GET /api/one_click_shell` | — | 无线 ADB | `main.js:4497-4527` |
| TTYD 端口 + 提交 | 存 localStorage | — | — | `main.js:3166-3178` |
| 资源服务器 + 提交 | `POST /api/set_res_server` | — | — | `main.js:3180-3196` |
| 重置TTYD端口 | localStorage 改回 1146 | — | — | `main.js:7147-7154` |
| 清除所有上传的文件 | `POST /api/delete_all_uploads_data` | — | — | `main.js:7155-7205` |
| 上传文件管理 | 见 5.9 | `user_shell` 等 | — | `main.js:7795-7894` |
| 「?」 | 彩蛋：toast「获得成就：原神启动！」，并在 TTYD 区块嵌入一个外网云游戏 iframe | 外网 | — | `main.js:5096-5110` |

**`togglePort(port, flag, isBootup, v6)`**（`main.js:7012-7092`）：

1. 清理旧规则：对 filter / nat / mangle / raw / security 每张表执行 `iptables-save -t <表> | grep -- '--dport <port> .*DROP' | sed 's/-A/-D/' | while read line; do iptables $line; done`（勾选 IPv6 时 `ip6tables` 再做一遍）；
2. 阻止（`flag = false`）：`iptables -A INPUT -p tcp --dport <port> -j DROP`（IPv6 同理）；放行（`flag = true`）：只做第 1 步；
3. 开机持久化：先 `sed -i '/# UFI-TOOLS .* <port>/d' /sdcard/ufi_tools_boot.sh` 删掉旧行；勾选「开机自动应用」时追加一行 `(<命令> >/dev/null 2>&1 &) # UFI-TOOLS v4|v6 <port>`；
4. 只处理 TCP。

坑：`toggleTTYD` / `toggleADBIP` 没有 `await togglePort`，**永远提示成功**（`main.js:7099-7101`）；`setPort` 失败时先提示失败、紧接着又提示成功（`main.js:7213-7215`）。

**Log 与唤醒锁**：

- `set_log_status` 控制后端 `KanoLog`，它只写 Android logcat，不写文件（`KanoLog.kt:6-41`）。`GET /api/get_log_status` → `{"debug_log_enabled": "false"}`（字符串），**原版前端从未读取**。
- `set_wakelock_status` 持有或释放 CPU 唤醒锁并持久化（`AppMeta.kt:142-153`）；**没有读取接口**，前端无法显示当前状态。新版只能做成「启用 / 禁用」两个按钮，或在本地记住上次操作。
- 原版成功判断写成了 `if (result.success) throw`（`result` 是字符串，永远是 undefined），失败分支引用了未定义的变量 `res`（`main.js:7120-7126`、`7137-7143`）：网络失败时抛 ReferenceError，用户看不到任何提示。
- 唤醒锁按钮在高级功能弹窗里也有一份（`index.html:1691-1694`）。

**资源服务器**：`GET /api/get_res_server` → `{"res_server":"https://pan.kanokano.cn"}`；`POST /api/set_res_server {"res_server":"…"}`，空值 → 500 `{"error":"请提供 res_server"}`（`configModule.kt:87-137`）。只用于在线 OTA 和插件商店（`AppMeta.kt:40`），新版不需要。

**one_click_shell**：`GET /api/one_click_shell`（`advancedToolsModule.kt:255-369`）。后端用 adb 模拟点击：唤醒屏幕 → 打开展锐工程模式 → 点「DEBUG&LOG」→「Adb shell」→ 粘贴 `sh /sdcard/one_click_shell.sh` → 点「START」。HTTP 200 流式返回 `{"result":"执行成功"}` / `{"result":"执行失败"}` / `{"error":"one_click_shell执行错误：…"}`。前端要求 `adb_alive` 为真，否则 toast「ADB未初始化，请等待初始化完成」。脚本以工程模式的 shell 身份运行（非 root），输出看不到。高级功能开启后，这个能力完全可以被 Root Shell 替代，新版不建议保留。

### 5.7 高级功能弹窗的其它按钮

弹窗 `#advanceModal`（`index.html:1640-1713`）：红字警告（`advance_warning`）、功能说明（`advance_feature_list`，`zh.json:311-312`，其中提醒「开启高级功能后请不要使用有线ADB，否则可能导致USB网络断流卡顿」）、两行状态（`.socat_status`、`.adb_status`）、按钮组、执行结果 `#AD_RESULT`。

| 按钮 | 说明 |
| --- | --- |
| 添加高级功能 / 移除高级功能(重启生效) | 见 5.1 |
| 禁用ZXE固件更新 | 见下 |
| 编辑启动脚本 | 见下 |
| 提取Boot | 见下 |
| 启用 / 禁用唤醒锁 | 见 5.6 |
| 有线ADB / 无线ADB | 见第 6 节 |
| 性能模式 | 见 9.10 |

**禁用固件更新**（`main.js:6103-6154`）：

- 高级功能已开启：toast「检测到高级功能，使用ROOT方式执行」，依次用 root shell 执行 `pm disable com.zte.zdm`，`pm uninstall -k --user 0` 卸载 `com.zte.zdm`、`cn.zte.aftersale`、`com.zte.zdmdaemon`、`com.zte.zdmdaemon.install`、`com.zte.analytics`、`com.zte.neopush`，最后 `am force-stop com.zte.zdm`，结果逐行显示，标题「已使用ROOT方式禁用系统更新,执行成功！」。
- 未开启：toast「未开启高级功能，使用ADB方式执行」；要求 `adb_alive`，然后 `GET /api/disable_fota`（后端通过 adb 执行同一组命令，`KanoUtils.kt:786-817`）→ `{"result":"执行成功,如需强力禁用请使用高级功能！"}`。⚠️ 后端不检查每条命令的结果，**几乎总是返回成功**；同时有两个请求时，后一个返回 500 `{"error":"禁用系统更新出错：禁用系统更新失败"}`。
- 坑：未开启且 ADB 未就绪的分支清空的是 AT 弹窗的 `AT_RESULT`，而不是本弹窗的 `AD_RESULT`（`main.js:6133-6134`）。
- 另外，高级功能脚本每次开机都会执行同样的禁用（`samba_exec.sh:290-298`）。

**编辑启动脚本**（`utils.js:1118-1170`）：

- 需要高级功能；先用 root shell 读 `timeout 5s awk '{print}' /sdcard/ufi_tools_boot.sh`，然后关闭高级功能弹窗，打开一个全宽文本框。
- 保存（`saveConfig`，`utils.js:1086-1116`）：把内容做成文件上传到 `/api/upload_img` → root `ls` 确认文件在 → root `mv <filesDir>/uploads/<uuid>.sh /sdcard/ufi_tools_boot.sh`。内容为空时写入默认脚本 `#!/system/bin/sh\n# put script content here!!!\nsync\n\n`。成功 toast「保存成功，已同步至机器~」。
- 之所以「先上传再 mv」，是为了避开命令行转义问题。
- 定时脚本 `/sdcard/ufi_tools_schedule.sh` 原版**没有**编辑入口，只能用 TTYD 改。User_Doc 建议脚本「一行一个、用 nohup & 后台运行」（`User_Doc.md:1956-1957`）。

**提取 Boot**（`main.js:6156-6180`）：

1. root：`getprop ro.boot.slot_suffix`，输出含 `a` 就当 A 槽，否则 B 槽，toast「你当前的分区槽位是 A/B」；
2. `mkdir` uploads 目录、删除旧文件；
3. `dd if=/dev/block/by-name/boot_<a|b> of=<filesDir>/uploads/boot_<a|b>.img`；
4. 浏览器下载 `/api/uploads/boot_<a|b>.img`。

坑：`dd` 用的是默认 10 s 超时；镜像较大时 fetch 先超时，但 `dd` 还在后台继续，前端马上去下载会拿到不完整的文件【推断】。`includes('a')` 判断槽位很粗糙。文件一直留在 uploads 里，不清理。

**小核开关** `switchCpuCore`（`main.js:5318-5332`）：root 执行 `echo 0|1 > /sys/devices/system/cpu/cpu0..3/online`。**当前 `index.html` 没有按钮**，只挂在 `window` 上（`main.js:8487`），User_Doc 仍描述了这个功能。新版不保留。

### 5.8 日志查看

原版**没有日志查看界面**。设备上现有的日志：

| 日志 | 路径 | 来源 | 大小控制 |
| --- | --- | --- | --- |
| 高级功能脚本日志 | `/sdcard/smb_log.log` | `samba_exec.sh` | ≥ 4 MB 时清空 |
| 保活守护日志 | `/sdcard/ufi_keep_alive.log` | `ufi_keep_alive.sh` | ≥ 1 MB 时清空 |
| OTA 安装日志 | `/sdcard/ufi_tools_update.log` | `install_apk` 生成的脚本 | 不清理 |
| 后端调试日志 | Android logcat，tag 前缀 `UFI_TOOLS_LOG` | `KanoLog`，需要先 `set_log_status` 打开 | 系统环形缓冲区 |

新版若要做「日志查看」【推断】：

- 有 root：`POST /api/root_shell {"command":"tail -n 300 /sdcard/smb_log.log 2>&1","timeout":10000}`；
- 无 root：`POST /api/user_shell {"command":"tail -n 300 /sdcard/ufi_tools_update.log 2>/dev/null"}`（App 有存储权限，需真机验证能否读取）；
- logcat：`logcat -d -t 500 -v time` 经 `user_shell` 执行，App 身份只能看到自己的日志。

### 5.9 上传文件管理与清理【代码】

- **打开**（`main.js:7795-7894`）：`POST /api/user_shell {"command":"ls /data/data/com.minikano.f50_sms/files/uploads/"}`，把 `content` 按 `\n` 切成列表。每一行：文件名（点击复制 `/api/uploads/<文件名>`）、下载、预览（新标签页打开）、删除。删除需要 3 s 内连点 3 次（toast「再点 N 次删除」）→ `POST /api/delete_img {"file_name":"<文件名>"}`。
- **上传**（按钮「上传文件(最大100MB)」）：`uploadFileKano(file, true)`（`utils.js:1179-1233`）。前端限制 100 MB → `POST /api/upload_img`（字段名 `file`）→ 原文件名符合 `^[a-zA-Z0-9_.]+$` 时，用 `user_shell` 执行 `mv <uuid>.<ext> <原文件名>` 改回原名，再 `ls` 校验。
- **坑**：
  - 目录为空时 toast「没有文件」，并且**不打开弹窗——这时也没法上传**；
  - 从没上传过时 uploads 目录不存在，`ls` 写 stderr → `user_shell` 返回 500 → toast「读取文件失败」；
  - 同名文件 `mv` 会直接覆盖。
- **清空**（开发者菜单「清除所有上传的文件」）：5 s 内点 4 次（toast「Click N times to confirm」，英文没翻译）→ `POST /api/delete_all_uploads_data` → `{"result":"success","deleted_list":{"<文件名>":true}}`，弹窗列出每个文件的 OK / FAILED；没有文件时 `deleted_list` 是 `{}`，只 toast「操作成功」。
- **后端细节**（`themeModule.kt:58-275`）：
  - 上传：`multipart/form-data`，字段名随意，所有文件部分都会写盘；保存为 `<UUID>.<原扩展名小写>`（没有扩展名时为 `.unknown`）；有多个文件时只返回最后一个的地址；返回 `{"url":"/uploads/<uuid>.<ext>"}`，实际访问地址要加 `/api` 前缀；
  - 读取：`GET /api/uploads/<文件名>` **免鉴权**，有路径穿越保护（越界 403，不存在 404）；
  - `delete_img`：文件不存在也返回 success；文件名含 `..` 或以 `/` 开头 → 403 `{"error":"非法文件名"}`。
- **关联**：主题背景图、插件资源、启动脚本中转、Boot 镜像、**OTA 安装包中转**（第 7 节）都放在这个目录。删除文件会让引用它的背景或插件失效（`User_Doc.md:2148-2160`）。

---

## 6. ADB

### 6.1 有线 ADB（USB 调试）【代码】

- 原版位置：高级功能弹窗里的按钮 `#ADB`（`index.html:1695`），文字「有线ADB」（`zh.json:29`）。
- 读：`cmd=usb_port_switch` → `"0"` / `"1"`（主页轮询字段里也有）。
- 写：`USB_PORT_SETTING`，`usb_port_switch` 取当前值的反；成功 toast「操作成功」并重新读取（`main.js:1108-1147`）。无确认。
- 提示：开启高级功能后不要再开有线 ADB，它和 USB 网络共享抢同一个 USB 口，会导致断流（`zh.json:312`）。
- 定时任务的「USB调试」模板用的是同一个 goformId。

### 6.2 无线 ADB（开机自启）【代码】

- 原版位置：高级功能弹窗 `#ADB_NET`（`index.html:1697`），文字「无线ADB」。
- 读：`GET /api/adb_wifi_setting` → `{"enabled":false}`。值是**布尔**，来自 prefs 字符串 `ADB_IP_ENABLED`，默认 `"false"`（`adbModule.kt:80-98`）。
- 写：`POST /api/adb_wifi_setting`，body `{"enabled":true,"password":"<官方后台密码明文>"}`（`adbModule.kt:101-147`）：
  - `enabled = true`：保存 `ADMIN_PWD = password` 和 `ADB_IP_ENABLED = "true"`；
  - `enabled = false`：**删除 `ADMIN_PWD`**，`ADB_IP_ENABLED = "false"`；
  - 响应 `{"result":"success","enabled":"true"}`（`enabled` 是字符串）；body 解析失败 → 500 `{"error":"参数解析失败"}`。
- 原版点击流程（`main.js:1150-1206`）：
  1. 必须通过 `checkAdvancedFunc()`，否则 toast「需要启用高级功能才可使用」；
  2. `login()` 验证官方后台密码；
  3. POST，`password` 用登录时输入的官方后台密码；fetch 超时 3 s；
  4. toast「操作成功！重启生效」，重新读取有线和无线两个状态。
- **生效机制**（`ShellKano.kt:618-757`）：App 每次启动都会 `setprop service.adb.tcp.port 5555`；`ADB_IP_ENABLED == "true"` 时还会等官方后台可用（最多 30 s），优先用高级功能唤醒 adbd，否则登录官方后台写 `SetUpgAutoSetting`（禁止 FOTA），并在 `smb.conf` 被改过时发 `SAMBA_SETTING=1`。所以「无线 ADB」本质上是「开机自动恢复」的偏好，**重启后才生效**。
- **坑**：
  - 关闭无线 ADB 会删掉 `ADMIN_PWD`，之后定时任务的 goform 动作会用默认密码 `Wa@9w+YWRtaW4=` 登录（`TaskScheduler.kt:230`），在改过密码的设备上全部失败。新版关闭后立刻再调用一次 `POST /api/update_admin_pwd` 把密码补回去。（`Wa@9w+YWRtaW4=` 也是原版登录框「免密登录」按钮填入的官方后台密码，`main.js:7929-7944`，推断是部分固件接受的特殊值【推断】。）
  - 原版要求先开高级功能才能切换，但后端没有这个限制。是否保留这个限制由产品决定。

### 6.3 无线 ADB 就绪状态【代码】

- `GET /api/adb_alive` → `{"result":"true"}` 或 `{"result":"false"}`（字符串，`adbModule.kt:150-157`）。值是 `ADBService.adbIsReady`：后端持续探测 `localhost:5555` 能否连上 adb。
- 原版用途：高级功能 / OTA 弹窗里的状态行（`main.js:4478-4494`，**只在页面加载时查一次**）；OTA 非 root 安装、one_click_shell、禁用更新（ADB 方式）的前置检查。
- 状态行文案：「网络ADB状态：🟢 正常」或「🟡 等待初始化」；「USB调试开关：开启 / 未开启」（取 `UFI_DATA.usb_port_switch`）；「固件版本：<cr_version>」。

### 6.4 官方后台密码同步（`ADMIN_PWD`）【代码】

- `POST /api/update_admin_pwd {"password":"…"}` → `{"result":"success"}`，明文存进 prefs（`adbModule.kt:26-56`）。原版在两处调用：登录成功时（`main.js:571-575`）、修改官方后台密码成功时（`main.js:3652`）。新版登录流程也要保留这一步。
- `GET /api/get_official_web_password` → `{"pwd":"<明文>"}`，从没保存过时为 `""`（`adbModule.kt:59-77`）。原版只在「更改密码」弹窗里显示「当前UFI-TOOLS保存的密码为：xxx」（`main.js:3600-3611`）。⚠️ 明文回显；新版建议只显示「已同步 / 未同步」，或打码并提供「显示」按钮。

---

## 7. OTA：本地上传安装

### 7.1 原版在线 OTA（只作说明，新版不做）【代码】

- 入口「软件更新」→ `#updateSoftwareModal`（`index.html:1860-1886`）：高级功能状态、ADB 状态、两条提示（`zh.json:373-374`：需要高级功能或网络 ADB；更新时不要断电，无电池机型确保 5V 2A 以上供电）、更新信息、更新日志、「一键更新」「下载安装包」「关闭」。右上角有一个透明按钮，2 s 内连点 5 次可强制允许更新（`utils.js:1066-1083`）。
- `GET /api/check_update` → `{base_uri, alist_res, changelog}`。前端从 `alist_res.data.content` 里筛出名字含 `.apk` 的项，按 `modified` 倒序取第一个（`main.js:4206-4232`）。
- 版本比较（`main.js:4359-4447`）：文件名 `V(\d+\.\d+\.\d+)` 与当前 `app_ver` 做**字符串比较**（`"4.10.0" > "4.9.0"` 为 false，是 bug，`:4383`）；版本相同再比文件名里的 8 位日期与 `app_ver_code`；文件名含 `force` 视为常驻更新。
- 一键更新（`main.js:4266-4340`）：前置条件是高级功能已开启（「极速更新」），或 `adb_alive` 为真（否则 toast「ADB未初始化，请等待初始化完成;或直接开启高级功能，享受极速安装！」）→ `POST /api/download_apk {"apk_url": base_uri + name}` → 每 500 ms 查 `download_apk_status` → `percent == 100` 时调用 `install_apk`。
- 下载安装包：浏览器直接打开 `base_uri + name`。
- 页面加载 100 ms 后静默检查一次，发现更新就弹出提示，8 s 后自动关闭（`main.js:4530-4578`）。
- 依赖外网 `pan.kanokano.cn`（alist）。`check_update` 后端把 alist 原始响应直接拼进 JSON（`otaModule.kt:78-84`），上游异常时整个响应会变成非法 JSON。

### 7.2 本地上传安装：逐步核实

总流程：**选择 APK → 上传到设备 → 让后端从本机地址「下载」→ 轮询下载状态 → 安装 → 等服务恢复并核对版本 → 清理**。之所以要绕「下载」这一步，是因为 `install_apk` 只认 `download_apk` 写进内存的路径（`otaModule.kt:192-196`）。

#### 第 0 步：预检

| 检查项 | 方法 | 不通过时 |
| --- | --- | --- |
| 安装通道 | `POST /api/root_shell {"command":"whoami","timeout":5000}` 含 `root` → 走 root 通道；否则 `GET /api/adb_alive` 为 `"true"` → 走 ADB 通道 | 两个都没有：阻止安装，提示「需要先开启高级功能或无线 ADB」。不能放行：后端会硬走 ADB 自动化，耗时很长后才报错 |
| 存储空间 | `GET /api/baseDeviceInfo` 的 `internal_available_storage`（字节）≥ 文件大小 × 2.2 | 上传一份、下载一份都在 `/data` 分区【推断】 |
| 文件 | 扩展名 `.apk`、大小 > 0 | 提示重新选择 |
| 版本（可选） | 文件名符合 `UFI-TOOLS_WEB_V<版本>_<yyyyMMdd>_<HHmm>.apk`（`build.gradle.kts:107-115`）时解析出版本和日期，与 `GET /api/version_info` 的 `app_ver` / `app_ver_code` 对比 | 日期更早：警告「`pm install -r` 不允许降级，安装会失败」【推断】 |
| 签名 | 无法预检 | 提示：APK 签名必须与设备上已装的一致，否则安装失败；从原作者版本换成自签名版本需要先卸载【推断】 |
| 供电 | — | 提示更新期间不要断电（`zh.json:374`） |

#### 第 1 步：上传 `POST /api/upload_img`【代码】（`themeModule.kt:114-164`）

- `multipart/form-data`，字段名任意，建议 `file`；需要签名头（签名路径 `/api/upload_img`）。
- 保存到 `<filesDir>/uploads/<UUID>.<扩展名小写>`。原文件名必须以 `.apk` 结尾，否则扩展名不是 `apk`（后面的下载地址也要跟着变）。
- **后端代码不限制大小**，流式写盘；Ktor 2.3.9 的 `receiveMultipart()` 默认只限制普通表单字段，不限制文件部分【推断（框架默认）】。前端建议上限 100 MB（与原版上传文件管理一致）。
- 进度：`fetch` 拿不到上传进度，用 `XMLHttpRequest` 的 `upload.onprogress`，签名头手动加。
- 成功：`{"url":"/uploads/0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk"}`。
- 失败：500 `{"error":"上传文件出错: <原因>"}`（原因未转义）；没有文件部分时原因为「文件上传失败」。

#### 第 2 步：触发「下载」 `POST /api/download_apk`【代码】（`otaModule.kt:100-162`）

```json
{ "apk_url": "http://127.0.0.1:2333/api/uploads/0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk" }
```

- `apk_url` = `http://127.0.0.1:2333/api` + 第 1 步返回的 `url`。服务端口固定 2333（`WebService.kt:98`）。
- `/api/uploads/…` 在鉴权白名单里（`KanoAuth.kt:27-29`），后端自己下载不需要签名。
- 立即返回 `{"result":"download_started"}`，下载在后台线程进行：
  - 状态重置为「下载中、进度 0」，删除旧的 `downloaded_app.apk`；
  - 用 OkHttp 下载（连接 15 s、读 30 s、不限总时长，`KanoHttp.kt:25-31`），**要求 HTTP 2xx 且 `Content-Length > 0`**（`KanoRequest.kt:57-73`）——`/api/uploads` 由 Ktor `respondFile` 返回，带 `Content-Length`【推断（框架行为）】；
  - 写到 `/sdcard/Android/data/com.minikano.f50_sms/files/downloaded_app.apk`（`getExternalFilesDir(null)`）。
- 同一个 URL 正在下载时直接忽略，同样返回 `download_started`；不同 URL 会再开一个线程，两个线程写同一个文件——**新版不要并发调用**。
- 失败：`apk_url` 为空 → 500 `{"error":"请提供 apk_url"}`；body 不是 JSON → 500，`error` 为 org.json 的异常文本。

#### 第 3 步：轮询 `GET /api/download_apk_status`【代码】（`otaModule.kt:165-183`）

```json
{
    "status": "downloading",
    "percent": 42,
    "error": ""
}
```

- `status` 判定顺序：下载线程在跑 → `downloading`；有错误 → `error`；有结果路径 → `done`；否则 `idle`。
- `percent`：0–100 的整数，只在变化时更新；完成后保持最后的值。
- `error`：失败原因。`"下载失败"` 表示非 2xx、`Content-Length ≤ 0`、空 body 或写盘异常；网络异常时是异常 message（例如连接被拒）。没有转义。
- 轮询：原版 500 ms 一次。本机回环下载很快，建议 300–500 ms，最长等 60 s。
- **以 `status == "done"` 为准进入安装，不要用 `percent == 100`**：进度回调先到 100，结果路径稍后才写入，这个窗口期里调 `install_apk` 会得到「未检测到已下载的 APK」。原版就是用 `percent == 100` 判断的（`main.js:4328`）。
- 原版的错误判断写成了 `res.error == 'error'`（`main.js:4325`），而 `error` 字段装的是错误文本，所以 `status == "error"` 时原版不会停，一直显示「❌ 下载失败」并继续轮询。新版以 `status` 判断。
- 状态只存在内存里，App 重启后变回 `idle`，需要重新执行第 2 步。

#### 第 4 步：安装 `POST /api/install_apk`【代码】（`otaModule.kt:186-374`）

- 无请求体（需要签名）。响应是**流式的，HTTP 状态码固定 200**，body 是一个 JSON：`{"result":"success"}` 或 `{"error":"…"}`。客户端先 `await res.text()` 再解析。
- 先检查第 2 步的结果路径；为空 → `{"error":"未检测到已下载的 APK"}`。
- **root 通道**（socket 存在且 `whoami` 含 `root`；探测本身的读超时 60 s）：
  - 生成脚本 `ufi_tools_update_by_socat.sh`，用 `nohup` 后台执行：`pm install -r -g "<downloaded_app.apk>"`，然后 `dumpsys activity start-activity -n com.minikano.f50_sms/.MainActivity --ez silent true` 重新拉起 App，`sync` 两次，输出全部追加到 `/sdcard/ufi_tools_update.log`；
  - **等 2 s 后返回 `{"result":"success"}`**。这只表示脚本已启动，不代表安装成功。
- **ADB 通道**（root 不可用时）：
  - 把 APK 复制到 `/sdcard/ufi_tools_latest.apk`，生成 `/sdcard/ufi_tools_update.sh`；
  - adb 模拟点击：返回键 ×10 → 唤醒屏幕 → 打开工程模式 → 「DEBUG&LOG」→「Adb shell」→ 粘贴 `sh /sdcard/ufi_tools_update.sh` → 点「START」，最多重试 3 轮；
  - 成功 `{"result":"success"}`；粘贴执行失败 `{"error":"执行 shell 命令失败: <原因>"}`；点击流程失败 `{"error":"异常: click_stage 多次重试失败"}`；
  - 耗时可能几十秒到两分钟【推断】，前端 fetch 超时至少设 180 s。
- 安装开始后，`pm install -r` 会替换 APK 并杀掉 App 进程，**Web 服务随之中断**。所以这个请求可能正常收到 `success`，也可能直接网络错误——两种情况都进入第 5 步。原版在网络错误时也当作「安装成功，等待几秒刷新网页即可使用」（`main.js:4251-4258`）。

#### 第 5 步：等服务恢复并核对版本【推断】

- 每 2 s 请求一次 `GET /api/version_info`（免鉴权，不受口令影响），最长 180 s。先会失败（服务下线），之后恢复。
- 恢复后对比 `app_ver` / `app_ver_code` 与安装前的值：
  - 变了 → 成功，提示刷新页面加载新前端；
  - 没变 → 大概率 `pm install` 失败。有 root 时用 `root_shell` 执行 `tail -n 20 /sdcard/ufi_tools_update.log 2>&1` 展示原因。常见：`INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名不同）、`INSTALL_FAILED_VERSION_DOWNGRADE`（版本更旧）、`INSTALL_PARSE_FAILED_…`（文件损坏）、`INSTALL_FAILED_INSUFFICIENT_STORAGE`（空间不足）；
  - 注意：`app_ver_code` 是构建日期 `yyyyMMdd`，同一天的两个构建号码相同，版本号也没改时无法从接口区分，只能提示「服务已重新上线」。
- 180 s 仍不可用：提示手动刷新；高级功能开启时保活脚本会在 30 s 内拉起 App（`ufi_keep_alive.sh:5`）；仍不行就重启设备。

#### 第 6 步：清理

- 第 3 步得到 `done` 之后，上传目录里那份已经没用（安装用的是 `downloaded_app.apk`），可以立刻 `POST /api/delete_img {"file_name":"<uuid>.apk"}` 释放空间。
- `downloaded_app.apk` 没有删除接口；下次执行第 2 步时会先删除再下载，或者用 `user_shell rm` 删除。

### 7.3 失败场景对照

| 阶段 | 现象 | 原因 | 处理 |
| --- | --- | --- | --- |
| 预检 | 没有 root，`adb_alive` 也是 `"false"` | 没有安装通道 | 引导开启高级功能或无线 ADB |
| 上传 | 401 | 签名或口令失效 | 重新登录 |
| 上传 | 500「上传文件出错」 | 写盘失败（空间不足等） | 提示清理空间 |
| 上传 | 网络中断 | Wi-Fi 断开、长时间无数据被服务端断开 | 重试 |
| 下载 | `status: error`，`error: "下载失败"` | 上传文件不在了、地址拼错（扩展名不是 apk）、写盘失败 | 检查第 1 步返回的地址后重试 |
| 下载 | 长时间 `downloading` | 下载线程卡住（读超时 30 s 后会报错） | 60 s 后按失败处理 |
| 安装 | `{"error":"未检测到已下载的 APK"}` | 没等到 `done`，或期间服务重启过 | 重新执行第 2、3 步 |
| 安装 | `{"error":"异常: click_stage 多次重试失败"}` | ADB 自动化失败 | 建议开启高级功能后重试 |
| 安装 | fetch 网络错误 | App 进程被替换（正常现象） | 进入第 5 步 |
| 恢复 | 180 s 仍不可用 | App 没被拉起 | 手动刷新或重启设备 |
| 恢复 | 版本没变 | `pm install` 失败 | 读 `/sdcard/ufi_tools_update.log` |

### 7.4 在线接口（只说明，新版不做）

| 接口 | 作用 | 不做的原因 |
| --- | --- | --- |
| `GET /api/check_update` | 从资源服务器（alist）取版本列表和更新日志 | 依赖外网 `pan.kanokano.cn` |
| `POST /api/download_apk`（外网 URL） | 下载更新包 | 同上；本地方案只用它的「本机下载」能力 |
| `GET/POST /api/get_res_server`、`set_res_server` | 资源服务器地址 | 只服务于在线 OTA 和插件商店 |
| `GET /api/plugins_store` | 插件商店列表 | 已决定去掉插件市场 |

---

## 8. 代理 / 反向代理 / 内网穿透

### 8.1 万能代理 `/api/proxy/--<目标URL>`【代码】（`anyProxyModule.kt`）

- **能做什么**：让设备替浏览器请求**公网** HTTP(S) 地址。用途是绕过浏览器跨域限制，以及让流量走设备的蜂窝出口。支持任意方法，POST / PUT / PATCH 的请求体原样转发并保留 Content-Type。
- **不能做什么**：目标域名解析到 `0.0.0.0`、环回、链路本地、私网地址（192.168/10/172.16–31）时一律 403（`:56-79`），所以不能访问局域网或设备自己；`ufi.ztedevice.com` 被禁止。它不是正向代理服务器，也不是内网穿透。
- **参数**：路径里 `/api/proxy/` 之后的全部内容（**包括查询串**）就是目标 URL，`--` 前缀可省略（`:86-87`）。需要签名，签名路径用原始路径（`/api/proxy/--https://…`，不含查询串；`KanoAuth.kt:71-77`）。
- **请求头**：以 `kano-` 开头的头去掉前缀后转发（`kano-cookie` → `Cookie`，`kano-Authorization` → `Authorization`）；`authorization` 等在过滤名单里的头不转发（`:22-29`、`:108-120`）。⚠️ 签名头 `kano-t`、`kano-sign` 也会被去前缀，以 `t`、`sign` 的名字发给目标服务器——`API_Doc.md` §3.12 说它们不转发，与代码不符（泄露的只是时间戳和签名，不含口令）。
- **响应**：状态码和 Content-Type 透传；HTML 响应会把 `src/href="/…"` 改写回代理路径；上游的 `Set-Cookie` 改名为 `Kano-SetCk` 和 `Kano-Set-Cookie`；请求带 Origin 时回写 CORS 头。
- **超时**：连接 10 s、读 8 s、写 8 s、**总时长 30 s**，不重试；强制 `Accept-Encoding: identity`（`:31-49`）。
- **错误**：403 纯文本 `Access to target address is not allowed.`；502 纯文本 `Empty response body` 或 `Proxy error: <原因>`。
- **状态**：无状态、无开关、无配置。
- **原版用途**：流量测速（4.2）、插件商店的自定义仓库与插件下载、公告接口。新版只保留流量测速这一个用途。

### 8.2 官方后台反代 `/api/goform/…`

已实现，见 `API_Doc.md` §3.13 与 `legacy-radio-dashboard.md`。

### 8.3 内网穿透 / 远程访问

- 原版**没有内置**内网穿透、端口映射或代理控制，也没有对应接口或状态读取。
- `User_Doc.md` §14.2 建议用插件商店里的 EasyTier / Tailscale 插件实现远程访问（`User_Doc.md:2196-2217`）——本质是自定义注入脚本加用户自行部署的程序。
- 新版：没有现成接口，按既定决策延后。若将来做，可借助高级功能的 Root Shell 和启动脚本实现【推断】。

---

## 9. 系统

### 9.1 重启【代码】

- 写：`REBOOT_DEVICE`，无参数。
- 原版：同一按钮 3 秒内连点 3 次，文字依次为「重启设备」→「再点二次」→「再点一次」→「正在重启」（`main.js:2010-2064`，细节见 `legacy-radio-dashboard.md` §8）。成功 toast「重启成功！」，失败「重启失败，请检查网络」。
- 新版：确认弹窗 → 调用 → 显示「设备重启中」，每 3 s 请求一次 `GET /api/version_info`（免鉴权），最长 3 min，恢复后重新建立官方后台会话【推断】。

### 9.2 关机【代码】

- 写：`SHUTDOWN_DEVICE`。
- 只在 `cmd=battery_value,battery_vol_percent` 两个值都非空时显示（有电池的机型，`main.js:3060-3069`）；F50 通常不显示。
- 原版确认方式有计数复位 bug，见 `legacy-radio-dashboard.md` §8。成功「关机成功！」，失败「关机失败！」，登录失败「登录失败，请检查密码和网络连接」。
- 新版：确认文案写明「关机后无法远程开机」。

### 9.3 恢复出厂

- 原版前端和 `API_Doc.md` **都没有**恢复出厂入口。代码里「恢复出厂」只出现在提示文案中（`zh.json:297`、`User_Doc.md` 的排障建议）。
- 中兴官方后台的 goformId 推断为 `RESTORE_FACTORY_SETTINGS`【推断】，必须先在 `http://192.168.0.1:8080` 官方后台操作一次并抓包，确认参数和影响范围：是否清除 UFI-TOOLS 的数据、是否改变网关 IP、官方后台密码和 Wi-Fi 配置。
- 恢复后官方后台密码会变回出厂值，与 `ADMIN_PWD` 不一致，定时任务会失败；当前连接可能断开。建议第一阶段不做；要做就放在「危险区」，要求输入确认文字。

### 9.4 修改登录口令（`set_token`，已实现，仅核对）【代码】

- 前端校验（`main.js:3694-3749`）：新口令和确认口令都不能为空、两次一致、trim 后 ≥ 8 位、匹配 `^(?=.*[a-zA-Z])(?=.*\d).{8,128}$`（原版用未 trim 的原值测正则）。失败文案：「请输入新口令」「请输入确认口令」「两次口令输入不一致」「口令至少需要8位!」「口令至少包含字母和数字!」。
- 请求：`POST /api/set_token {"token":"<trim 后的明文>"}`。
- 后端（`configModule.kt:43-84`）：trim；空 → 500 `{"error":"请提供 token"}`；不足 8 位 → `{"error":"token 需要至少8位"}`；不匹配正则（**包括超过 128 位**）→ `{"error":"口令需要至少同时包含数字和字母"}`；保存 `SHA256(口令)`，并重新计算弱口令标记；成功 `{"result":"success"}`。
- 成功后：本地 `authorization` 改为 `SHA256(新口令)` 的小写 hex；原版弹窗「保管你的口令 / 请截图或妥善保管好你的口令，以防遗忘」并大字显示明文，可点击复制。
- 联动：TTYD 的登录口令同时改变（`login.sh` 读的是同一个 `login_token`）；`is_weak_token` 随之更新。
- 弱口令提醒（`main.js:6891-6953`）：登录后、且已同意条款时，`GET /api/is_weak_token` → `{"is_weak_token":true}` 就弹出「检测到您使用了弱口令，您必须更改口令以保障设备安全。」，按钮「立即更改」/「推迟三天」（localStorage `weakTokenToastLater` 存到期时间戳）。弱口令规则：等于 `admin`、少于 8 位、没有数字或没有字母（`KanoUtils.kt:819-830`）。
- `GET /api/need_token`（免鉴权）→ `{"need_token": true}`；为 `false` 时登录页隐藏口令输入框（`main.js:109-153`）。该开关只能在设备本机的 App 里改。

### 9.5 修改官方后台密码【代码】

- 入口「更改密码」（`main.js:3613-3669`、`index.html:1715-1759`）。打开时显示「当前UFI-TOOLS保存的密码为：<get_official_web_password 的明文>」和警告「请务必通过 UFI-TOOLS 管理页面修改官方后台密码，请勿直接在官方后台修改。否则 UFI-TOOLS 保存的密码将与实际密码不一致，导致定时任务等功能无法正常使用！」（`zh.json:860-861`）。
- 表单：旧密码（**预填了 `02:00:00:00:00:00`**，大概是为了挡住浏览器自动填充）、新密码、确认密码；校验非空和两次一致。
- 请求：`CHANGE_PASSWORD`，`oldPassword = SHA256(旧密码)`、`newPassword = SHA256(新密码)`。`requests.js` 的 `SHA256` 输出**大写** hex，两个值都没有 trim。
- 成功：toast「修改成功」→ `POST /api/update_admin_pwd`（用 trim 后的新密码）→ 更新本地保存的官方后台密码。
- 坑：哈希用未 trim 的值、同步用 trim 后的值，密码首尾有空格时两边不一致。

### 9.6 版本信息【代码】

`GET /api/version_info`（免鉴权，`baseDeviceInfoModule.kt:325-347`）：

```json
{ "app_ver": "4.1.5", "app_ver_code": "20261029", "model": "F50", "nickname": "F50", "accept_terms": true }
```

- `app_ver`：versionName，当前仓库是 `4.1.5`（`build.gradle.kts:60`），`API_Doc.md` 写的 4.1.3 已过时。
- `app_ver_code`：versionCode，等于构建日期 `yyyyMMdd`（`build.gradle.kts:59`），是字符串。
- `model`：`Build.MODEL`，`MU5352` 显示为 `U30 Lite`（`AppMeta.kt:185`）。
- `nickname`：没设置过时**等于 `Build.MODEL`**，不是空串。
- 用字符串模板拼出来的：别名里含 `"` 时整个响应不是合法 JSON。
- 原版用途：页面标题「[<别名>]UFI-TOOLS v<版本>」（`main.js:2805-2819`）、OTA 版本比较、条款状态、判断是否 V50（决定 SIM 下拉选项）。
- 固件版本：goform 的 `cr_version`（主页轮询字段）；`wa_inner_version` 用于 AD 签名。
- release 构建的 APK 文件名：`UFI-TOOLS_WEB_V<versionName>_<versionCode>_<HHmm>.apk`（`build.gradle.kts:107-115`）。

### 9.7 设备信息与杂项【代码】

- **别名**：2 s 内连点型号文字 2 次（`main.js:4928-4941`），或在短信转发弹窗点「设置别名」，弹出输入框（最多 255 字，占位为型号）→ `POST /api/set_nickname {"nickname":"…"}`：trim，超过 255 截断，空字符串则恢复为 `Build.MODEL`（注意不是 `U30 Lite` 这种显示名）→ `{"result":"success"}`；失败 500 `{"error":"设置昵称出错"}`。用于页面标题和短信转发里的设备信息。
- **SELinux**：`GET /api/SELinux`（免鉴权）→ `{"selinux": "Permissive"}`，值来自 `getenforce`，失败为 `Unknown`。原版在值不是 permissive / disabled / 0 时 toast 10 s「你的系统版本不受支持,可能无法使用部分功能,请升级随身WiFi系统到合适的版本!」（`main.js:6823-6833`）。新版可做成设备信息里的一行兼容性提示。
- **设备 UUID**：`GET /api/device_id` → `{"device_id": "<uuid>"}`，只用于外网公告，新版不用。
- **USB 状态**：「USB状态」弹窗，打开后每 `REFRESH_TIME + 1000` ms 请求 `GET /api/usb_status`（`main.js:7747-7794`）：
  - 响应 `{"maxSpeed":<整数，Mbps>,"details":{"typec_mode":"host|gadget|unknown","gadget_speed":"USB 2.0 (480Mbps)|Unknown|unknown","devices":[{"path","product","speed"}]}}`（`DeviceInfo.kt:405-481`）；
  - `gadget`（作为 USB 设备接电脑）时显示 `gadget_speed`；`host`（外接 U 盘等）时显示 `maxSpeed` 和设备列表；
  - 失败 500 `{"error":"获取UsbDevices信息出错"}`，原版显示「暂无USB设备」。
- **网络连接数**：设备监控区的连接数卡片 → `GET /api/connInfo` → `{"result":"success","data":{"tcp":"23",…}}`，所有数字都是**字符串**，读取失败的项为 `"-1"`（`baseDeviceInfoModule.kt:215-230`、`DeviceInfo.kt:497-509`）。
- **用户协议**：登录后 `version_info.accept_terms` 为 `false` 时，弹出不可关闭的条款弹窗，必须手动输入确认文字才能 `POST /api/accept_terms`（→ `{"result":"success"}`，`main.js:6835-6889`）。条款是原作者的。新版是否保留由产品决定；如果不弹窗，目前只影响弱口令提醒（它要求已同意条款）【推断】。

### 9.8 自定义 head 注入【代码】

- **读**：`GET /api/get_custom_head`（**免鉴权**）→ `{"text":"…"}`（`pluginsModule.kt:111-133`）。
- **写**：`POST /api/set_custom_head {"text":"…"}`（`pluginsModule.kt:27-62`）。后端 trim；**整个请求体**按 UTF-8 计超过 5 MiB → 500 `{"error":"配置出错: 插件总容量超出限制: <n>KB/5120KB"}`；成功 `{"result":"success"}`。原版保存成功 toast「插件保存成功,正在刷新页面...」，2 s 后刷新页面（`main.js:6081-6101`）。
- **原版注入方式**（`main.js:54-87`）：页面一加载就请求（**不等登录**）→ `DOMParser` 解析 → `style`、`link`、`meta` 克隆进 `<head>`；`script` 逐个重新创建（保留 `src`、内联代码、`type`），失败 toast「自定义head解析失败，请检查内容是否正确。」。
- **存储格式**：原版「插件功能」把多个插件拼成一段文本：

  ```html
  <!-- [KANO_PLUGIN_START] 插件名 -->
  插件内容（HTML / script / style）
  <!-- [KANO_PLUGIN_END] 插件名 -->
  ```

  - 插件之间用 4 个换行分隔；解析正则 `/<!--\s*\[KANO_PLUGIN_START\]\s*(.*?)\s*-->([\s\S]*?)<!--\s*\[KANO_PLUGIN_END\]\s*\1\s*-->/g`（`main.js:6053`）；
  - 禁用的插件：内容被包成 `<!-- [kano_disabled]\n…\n[kano_disabled] -->`，即整体变成 HTML 注释（`main.js:5980-6004`）；
  - 原版单个插件文件限 10 MiB（`main.js:5787`），提示文案建议总量不超过 4 MB（`index.html:1322`）。
- **风险**：注入的脚本拥有页面的全部权限，可以读 localStorage 里的口令哈希和官方后台密码；原版插件依赖原版的 DOM 和全局函数（如 `#TTYD`、`window.UFI_DATA`、`createToast`），在 AirPulse 里大多会失效甚至报错。
- **新版建议**：放在「高级 → 自定义注入」；原样读写 `text`，**兼容上面的插件块格式**，不要破坏用户已有的数据（可以按块列出、启停、排序）；提供安全模式（例如地址带 `?safe=1` 时跳过注入），防止注入的脚本把页面搞坏后无法进入设置；注入时机放在应用挂载之后；不提供插件商店。

### 9.9 后端主题接口（是否还需要）【代码】

- `GET /api/get_theme`（免鉴权）、`POST /api/set_theme`：11 个字符串字段（见 `API_Doc.md` §3.10），重置时 POST `{}`。原版只有在「多设备同步」勾选（默认勾选）时才写入（`main.js:2838-2892`、`2924-2973`；`theme.js:164-259`），字段含义是原版的 HSL 主题色、背景图、毛玻璃和遮罩。
- 新版只有浅色 / 深色 / 跟随系统 + 5 种强调色，**不需要这个接口**。如果想多设备同步，可以挪用某个字段存自己的值【推断】，但旧版前端会误读，不建议。

### 9.10 其它设置项（官方快捷开关）【代码】

| 设置 | 读 `cmd=` | 写 goformId 和参数 | 取值 | 原版提示 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 有线 ADB | `usb_port_switch` | `USB_PORT_SETTING`：`usb_port_switch` | `0` / `1` | 操作成功 | `main.js:1108-1147` |
| 性能模式 | `performance_mode` | `PERFORMANCE_MODE_SETTING`：`performance_mode` | `0` / `1` | 操作成功！重启生效 | `main.js:1209-1246` |
| 指示灯 | `indicator_light_switch` | `INDICATOR_LIGHT_SETTING`：`indicator_light_switch` | `0` / `1` | 操作成功 | `main.js:1603-1641` |
| NFC | `is_support_nfc_functions`（为空或 0 时不显示）、`web_wifi_nfc_switch` | `WIFI_NFC_SET`：`web_wifi_nfc_switch` | `0` / `1` | 操作成功 | `main.js:3797-3850` |
| 文件共享 | `samba_switch` | `SAMBA_SETTING`：`samba_switch` | `0` / `1` | 操作成功 | `main.js:1517-1556` |
| 网络漫游 | `roam_setting_option,dial_roam_setting_option`（后者非空时优先） | `SET_CONNECTION_MODE`：`ConnectionMode=auto_dial`、`roam_setting_option`、`dial_roam_setting_option` | `on` / `off` | 操作成功 | `main.js:1558-1601` |
| USB 上网模式 | `usb_network_protocal` | `SET_USB_NETWORK_PROTOCAL`：`usb_network_protocal` | `0` 自动、`1` RNDIS、`2` CDC-ECM | 更改中，请稍后 → 操作成功！重启生效 | `main.js:1380-1430` |
| SIM 卡 | `sim_slot` | `SET_SIM_SLOT`：`sim_slot` | 普通双卡 `0` / `1`；V50：`0` 移动、`1` 电信、`2` 联通、`11` 外置 | 更改中，请稍后 → 操作成功 | `main.js:3758-3795`、`3852-3880` |
| 定时重启 | `restart_schedule_switch,restart_time` | `RESTART_SCHEDULE_SETTING` | 见 3.8 | 设置成功 | `main.js:2976-3046` |
| Wi-Fi 休眠（属热点模块） | `sleep_sysIdleTimeToSleep`（空则隐藏） | `SET_WIFI_SLEEP_INFO`：`sleep_sysIdleTimeToSleep` | `-1` 从不，`5` `10` `20` `30` `60` `120` 分钟 | 操作成功 | `main.js:7247-7298` |
| 数据开关 | 见 `legacy-radio-dashboard.md` §2.3 | | | | |

共同点：全部没有确认，点一下就切换。切换的目标值是「上次读到的值取反」，如果读取之后状态已经被别处改了，会切错方向。成功后重新读取；失败 toast「操作失败」；官方后台登录失败 toast「登录失败，请检查密码」并退出登录。

新版：开关做乐观更新，失败回滚；「重启生效」的项在控件下方注明；SIM 卡切换、USB 上网模式切换可能导致断网，加确认。

---

## 10. 依赖外网或不建议保留的原版功能

| 原版功能 | 依赖 | 建议 |
| --- | --- | --- |
| 在线 OTA（检查更新、一键更新、下载安装包、开屏更新提示） | `pan.kanokano.cn`（alist） | 删除，改为本地上传安装（第 7 节） |
| 插件商店（官方源、自定义源、插件下载、「投稿插件」邮件） | `pan.kanokano.cn`、任意外网地址、`mailto:plugin@kano.ink` | 删除（自定义注入保留，见 9.8） |
| 系统公告 | `api.kanokano.cn/ufi_tools_report` + 上报设备 UUID（`main.js:6956-7010`） | 删除 |
| 打赏 / 群组弹窗 | `api.kanokano.cn/pay`、`t.me` | 删除 |
| 资源服务器设置 | 只服务于在线 OTA 和插件商店 | 删除 |
| 开发者菜单「?」彩蛋 | 外网云游戏页面 | 删除 |
| 流量测速 | 用户填写的公网地址 | 保留（功能本身就需要外网），预置可编辑的地址 |
| 填入改串指令 | — | 不保留（合规风险） |
| one_click_shell | 工程模式界面自动化，非常脆弱 | 不保留（Root Shell 可以替代） |
| 小核开关 | 没有界面入口 | 不保留 |
| 提取 Boot | — | 可选；保留的话放进危险区，并修正超时 |
| 后端主题同步 | — | 不需要 |
| 用户协议弹窗 | 原作者的条款 | 需产品决定 |
| TTYD 嵌入地址用网关 IP | — | 改用当前访问的主机名 |

---

## 附录 A：原版的坑（本文范围速查）

1. `root_shell` 的 `result` 是字符串；`API_Doc.md` 写成 `{done, content}` 对象是错的（5.3）。
2. `user_shell` 只要 stderr 有输出就判失败，即使退出码为 0（5.4）。
3. Root Shell 只返回 stdout；`timeout` 是读超时，不是总时长（5.3）。
4. AT 基带返回 `ERROR` 时 HTTP 仍是 200；只有执行失败或超时才是 500；现有 mock 不一致（2.2）。
5. AT 指令里的 `'`、`$`、反引号会造成命令注入（2.4）。
6. 高铁模式的状态判断字符串可能因为引号永远匹配不上（2.3）。
7. 定时任务新建默认是一次性任务；时间不是两位数的 `HH:mm` 就永远不触发（3.3、3.7）。
8. 定时任务「性能模式」模板的 goformId 写错；模板里的中文占位会被原样提交（3.4）。
9. `list_tasks` / `get_task` 省略等于默认值的字段（3.2）。
10. 关闭无线 ADB 会删除 `ADMIN_PWD`，导致定时任务登录失败（6.2）。
11. 定时任务在加载时就捕获了 `ADMIN_PWD`，改密码后要重新加载才生效（3.5）。
12. 内网测速默认 8 GiB；所有测速都用 1024² 换算却标 Mbps（4.1）。
13. 流量测速受代理 30 s 总时长限制；地址已带 `?` 时拼接出错（4.2）。
14. 开启高级功能实际依赖无线 ADB；接口返回成功后还要等 30 s～2 min 才有 root（5.1）。
15. 高级功能弹窗打开时每 1 s 执行一次 `whoami`（5.1）。
16. TTYD 的 iframe 用网关 IP，远程访问时打不开；TTYD 端口实际写死 1146（5.5）。
17. 「禁用 TTYD / 无线 ADB 端口」和 `setPort` 永远提示成功（5.6）。
18. Log、唤醒锁开关的结果判断写错；唤醒锁没有读取接口（5.6）。
19. `disable_fota` 后端几乎总返回成功（5.7）。
20. 提取 Boot 的 `dd` 只有 10 s 超时（5.7）。
21. 上传文件管理在目录为空时无法打开，也就无法上传（5.9）。
22. OTA 用 `percent == 100` 判断下载完成，存在竞态；`status == "error"` 时不停止轮询（7.2 第 3 步）。
23. `install_apk` 的错误也是 HTTP 200；root 通道返回 `success` 只代表脚本已启动（7.2 第 4 步）。
24. 在线 OTA 的版本号用字符串比较（7.1）。
25. 很多错误响应没有转义，可能不是合法 JSON（1.1）。
26. `version_info` 的 `nickname` 默认等于型号；别名含 `"` 会破坏 JSON（9.6）。
27. 修改官方后台密码时，哈希用未 trim 的值、同步用 trim 后的值（9.5）。
28. 所有快捷开关都是「读到的值取反」，读取过期时会切错方向（9.10）。

---

## 附录 B：TypeScript 类型草案

```ts
/** GET /api/AT：基带 ERROR 也在 result 里，HTTP 200 */
export interface AtResponse { result?: string; error?: string }

/** POST /api/root_shell：result 是 stdout 字符串 */
export interface RootShellResponse { result?: string; error?: string }

/** POST /api/user_shell */
export interface UserShellResponse { result?: { done: boolean; content: string }; error?: string }

/** GET /api/volte_status、/api/vonr_status */
export interface ImsSwitchStatus { enabled: boolean }

/** GET /api/list_tasks、/api/get_task；等于默认值的字段会缺失 */
export interface TaskInfo {
  key: number
  id: string
  time: string
  repeatDaily: boolean
  actionMap?: Record<string, string>
  lastRunTimestamp?: number
  hasTriggered?: boolean
}
export interface TaskListResponse { tasks: TaskInfo[] }

/** POST /api/add_task；action 的值会被后端转成字符串 */
export interface AddTaskBody {
  id: string
  time: string           // 必须是两位数的 "HH:mm"
  repeatDaily?: boolean  // 后端默认 true
  action: Record<string, string | number>
}

/** GET /api/download_apk_status */
export type ApkDownloadState = 'idle' | 'downloading' | 'done' | 'error'
export interface ApkStatusResponse { status: ApkDownloadState; percent: number; error: string }

/** POST /api/install_apk：HTTP 恒为 200 */
export interface InstallApkResponse { result?: 'success'; error?: string }

/** POST /api/upload_img；实际地址是 "/api" + url */
export interface UploadResponse { url?: string; error?: string }

/** GET /api/version_info（免鉴权） */
export interface VersionInfo {
  app_ver: string
  app_ver_code: string   // yyyyMMdd
  model: string
  nickname: string       // 未设置时等于 model
  accept_terms: boolean
}

/** GET /api/hasTTYD */
export interface TtydProbe { code: string; ip: string }   // code: "200" | "-1" | 其它状态码

/** GET /api/adb_wifi_setting 与 POST 回显 */
export interface AdbWifiSetting { enabled: boolean }
export interface AdbWifiSettingWriteResponse { result: 'success'; enabled: 'true' | 'false' }

/** GET /api/adb_alive */
export interface AdbAlive { result: 'true' | 'false' }

/** GET /api/usb_status */
export interface UsbStatus {
  maxSpeed: number
  details: {
    typec_mode: 'host' | 'gadget' | 'unknown'
    gadget_speed: string
    devices: { path: string; product: string; speed: number }[]
  }
}

/** GET /api/connInfo：数字都是字符串，读失败为 "-1" */
export interface ConnInfo {
  result: 'success'
  data: Record<'tcp' | 'tcp_active' | 'tcp_other' | 'tcp6' | 'udp' | 'udp6' | 'unix', string>
}

/** GET /api/get_custom_head */
export interface CustomHead { text: string }
```

---

## 附录 C：Mock 用 JSON 样例

说明：

- 结构来自源码【代码】；具体数值是示例【推断】，除非另有标注。
- 真机上不少响应是多行缩进的 JSON（Kotlin 字符串模板 + `trimIndent`），Android 的 `org.json` 还会把 `/` 输出成 `\/`。这些都不影响 `JSON.parse` 的结果，mock 用单行即可。
- 未特别说明的错误响应都是 HTTP 500。

### C.1 AT 指令 `GET /api/AT`

```jsonc
// command=AT+CGEQOSRDP=1（签约速率）
{ "result": "+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK" }

// command=AT+CGSN（IMEI）
{ "result": "860000000000001 OK" }

// command=AT+CIMI（IMSI）
{ "result": "460001234567890 OK" }

// command=AT+CGMR（基带信息；真实格式未知，下面是占位值）
{ "result": "T760_MODEM_VERSION_PLACEHOLDER OK" }

// command=AT+CFUN=1,1（只有 OK 的写指令，开头带空格）
{ "result": " OK" }

// command=AT+CAVIMS?（VoLTE 状态的原始 AT）
{ "result": "+CAVIMS: 1 OK" }

// command=AT+SP5GCMDS="get nr synch_param",44（高铁模式：第 3 段 0 为关）
{ "result": "+SP5GCMDS: \"get nr synch_param\",44,0 OK" }

// 基带拒绝：HTTP 200，不是 500
{ "result": "ERROR" }
{ "result": "+CME ERROR: 4" }
```

```jsonc
// 500：执行失败或超过 60 s
{ "error": "AT指令执行错误：AT 指令没有输出" }
// 500：不以 AT 开头
{ "error": "AT指令执行错误：解析失败，AT指令需要以 “AT” 开头" }
// 500：缺 command
{ "error": "AT指令执行错误：缺少 query 参数 command" }
```

### C.2 VoLTE / VoNR

```jsonc
// GET /api/volte_status?slot=0、GET /api/vonr_status?slot=1
{ "enabled": true }
{ "enabled": false }
// 500
{ "error": "获取volte_status信息出错" }
{ "error": "获取vonr_status信息出错" }
```

```jsonc
// POST /api/volte_status  body: {"enabled":"0","slot":0}
{ "result": "success" }
// 500
{ "error": "设置volte状态出错" }
// POST /api/vonr_status 失败
{ "error": "设置vonr状态出错" }
```

### C.3 定时任务

```jsonc
// GET /api/list_tasks（按 key 升序；第二个任务从未执行，所以没有 lastRunTimestamp / hasTriggered）
{
  "tasks": [
    {
      "key": 1792483200000,
      "id": "每日重启",
      "time": "03:00",
      "repeatDaily": true,
      "actionMap": { "goformId": "REBOOT_DEVICE" },
      "lastRunTimestamp": 1793214000000,
      "hasTriggered": true
    },
    {
      "key": 1792569600000,
      "id": "夜间关闭WiFi",
      "time": "01:30",
      "repeatDaily": true,
      "actionMap": { "goformId": "switchWiFiModule", "SwitchOption": "0" }
    },
    {
      "key": 1793145600000,
      "id": "设备状态推送",
      "time": "09:00",
      "repeatDaily": false,
      "actionMap": { "kano_do_sms_forward_action": "1" },
      "lastRunTimestamp": 1793149200000,
      "hasTriggered": true
    }
  ]
}

// 没有任务
{ "tasks": [] }

// 500
{ "error": "获取任务列表失败" }
```

```jsonc
// GET /api/get_task?id=夜间关闭WiFi
{ "key": 1792569600000, "id": "夜间关闭WiFi", "time": "01:30", "repeatDaily": true, "actionMap": { "goformId": "switchWiFiModule", "SwitchOption": "0" } }
// 400（缺 id）
{ "error": "缺少任务ID" }
// 404
{ "error": "任务不存在" }
```

```jsonc
// POST /api/add_task
// body: {"id":"夜间关闭WiFi","time":"01:30","repeatDaily":true,"action":{"goformId":"switchWiFiModule","SwitchOption":0}}
{ "result": "success" }
// 500：缺 action
{ "error": "添加任务失败: 请传入action" }
// 500：id 或 time 为空
{ "error": "添加任务失败: 参数不完整" }
```

```jsonc
// POST /api/remove_task  body: {"id":"夜间关闭WiFi"}（id 不存在也返回 removed）
{ "result": "removed" }
// 500
{ "error": "删除任务失败: 参数id不能为空" }

// POST /api/clear_task（原版未使用）
{ "result": "success" }
{ "error": "清空定时任务出错: 任务调度器未初始化" }
```

### C.4 测速与代理

- `GET /api/speedtest?ckSize=4&cors`：200，`Content-Type: application/octet-stream`，`Content-Length: 33554432`，body 为随机字节。Mock 建议按固定速率（例如 300 Mbit/s）分块流式输出，避免开发服务器一次生成大文件。
- 第 4 个并发连接：429，`text/plain`，body `测速请求过多，请稍后再试`。
- `GET /api/proxy/--https://<测速文件>`：透传上游；Mock 可按 50 Mbit/s 输出随机数据，**30 s 后截断**。
- 目标为私网地址：403，`text/plain`，body `Access to target address is not allowed.`
- 上游失败：502，`text/plain`，body `Proxy error: timeout`。

### C.5 高级功能、Shell、TTYD

```jsonc
// GET /api/smbPath?enable=1
{ "result": "执行成功，等待1-2分钟即可生效！<br>Execution successful, please wait 1–2 minutes for it to take effect!" }
// 500
{ "error": "Error：开启高级功能失败(Adb与Shell方式执行不成功)，请打开网络ADB后再试<br>Failed to enable advanced features (resultAdb and resultShell execution unsuccessful)" }
{ "error": "Error：开启高级功能失败(配置文件没有更改或不存在)，请打开网络ADB后再试<br>Failed to enable advanced features (conf not changed or does not exist),please enable ADB" }

// GET /api/smbPath?enable=0
{ "result": "执行成功<br>Execution successful！" }
// 500
{ "error": "Error：执行命令失败，没有找到 socat 创建的 sock (高级功能是否开启？)<br>Command execution failed, could not find the sock created by socat (are advanced features enabled?)" }
```

```jsonc
// POST /api/root_shell  body: {"command":"whoami","timeout":5000}
{ "result": "root" }
// body: {"command":"/data/data/com.minikano.f50_sms/files/imei_reader","timeout":10000}
{ "result": "IMEI1:860000000000001\nIMEI2:860000000000002" }
// body: {"command":"getprop ro.boot.slot_suffix","timeout":10000}
{ "result": "_a" }
// body: {"command":"tail -n 3 /sdcard/ufi_tools_update.log 2>&1","timeout":10000}
{ "result": "Performing Streamed Install\nSuccess\nThu Oct 29 03:12:08 CST 2026install and sync complete!" }
// 500
{ "error": "shell执行出错: 执行命令失败，没有找到 socat 创建的 sock (高级功能是否开启？)" }
{ "error": "shell执行出错: 请检查命令输入格式" }
{ "error": "shell执行出错: 命令不能为空" }
```

```jsonc
// POST /api/user_shell  body: {"command":"ls /data/data/com.minikano.f50_sms/files/uploads/"}
{ "result": { "done": true, "content": "0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk\nboot_a.img" } }
// 空目录
{ "result": { "done": true, "content": "" } }
// 500：stderr 有输出（目录不存在）
{ "error": "shell执行出错: ls: /data/data/com.minikano.f50_sms/files/uploads/: No such file or directory" }
// 500：超时
{ "error": "shell执行出错: Error: Command timed out after 300 seconds" }
```

```jsonc
// GET /api/hasTTYD?port=1146
{ "code": "200", "ip": "192.168.0.1:1146" }
// 未开启高级功能（连不上）
{ "code": "-1", "ip": "192.168.0.1:1146" }
// 500
{ "error": "获取TTYD信息出错:query 缺少 port 参数" }
```

```jsonc
// GET /api/disable_fota
{ "result": "执行成功,如需强力禁用请使用高级功能！" }
{ "error": "禁用系统更新出错：禁用系统更新失败" }

// GET /api/one_click_shell（HTTP 恒为 200）
{ "result": "执行成功" }
{ "result": "执行失败" }
{ "error": "one_click_shell执行错误：click_stage1 多次重试失败" }
```

```jsonc
// GET /api/get_log_status（字符串）
{ "debug_log_enabled": "false" }
// POST /api/set_log_status  body: {"debug_log_enabled":true}
{ "result": "success" }
// POST /api/set_wakelock_status  body: {"wakelock_enabled":true}
{ "result": "success" }
// 两者 body 不是 JSON 时（500）：error 为 org.json 的异常文本
{ "error": "Value abc of type java.lang.String cannot be converted to JSONObject" }

// GET /api/get_res_server
{ "res_server": "https://pan.kanokano.cn" }
// POST /api/set_res_server
{ "result": "success" }
{ "error": "请提供 res_server" }
```

### C.6 上传文件

```jsonc
// POST /api/upload_img（multipart，字段 file）
{ "url": "/uploads/0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk" }
// 500
{ "error": "上传文件出错: 文件上传失败" }

// POST /api/delete_img  body: {"file_name":"0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk"}（文件不存在也返回 success）
{ "result": "success" }
// 403
{ "error": "非法文件名" }

// POST /api/delete_all_uploads_data
{ "result": "success", "deleted_list": { "0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk": true, "boot_a.img": true } }
{ "result": "success", "deleted_list": {} }
```

- `GET /api/uploads/<文件名>`（免鉴权）：200 返回文件内容并带 `Content-Length`；不存在 404 纯文本 `404 Not Found`；越界 403 纯文本 `403 Forbidden`。

### C.7 ADB

```jsonc
// GET /api/adb_wifi_setting（布尔）
{ "enabled": false }
// POST /api/adb_wifi_setting  body: {"enabled":true,"password":"<官方后台密码>"}（回显为字符串）
{ "result": "success", "enabled": "true" }
{ "error": "参数解析失败" }

// GET /api/adb_alive（字符串）
{ "result": "true" }
{ "result": "false" }

// GET /api/get_official_web_password（明文；从未保存时为空串）
{ "pwd": "admin" }
{ "pwd": "" }
// POST /api/update_admin_pwd  body: {"password":"admin"}
{ "result": "success" }
{ "error": "参数解析失败" }
```

### C.8 OTA

```jsonc
// POST /api/download_apk  body: {"apk_url":"http://127.0.0.1:2333/api/uploads/0c6c5a8e-1d2b-4f3a-9b7e-5a1f2e3d4c5b.apk"}
{ "result": "download_started" }
// 500
{ "error": "请提供 apk_url" }
```

```jsonc
// GET /api/download_apk_status 的四种状态
{ "status": "idle", "percent": 0, "error": "" }
{ "status": "downloading", "percent": 42, "error": "" }
{ "status": "done", "percent": 100, "error": "" }
{ "status": "error", "percent": 0, "error": "下载失败" }
```

```jsonc
// POST /api/install_apk（HTTP 恒为 200）
{ "result": "success" }
{ "error": "未检测到已下载的 APK" }
{ "error": "异常: click_stage 多次重试失败" }
{ "error": "执行 shell 命令失败: 未找到 START 按钮" }
```

```jsonc
// GET /api/check_update（在线 OTA，新版不用）
{
  "base_uri": "https://pan.kanokano.cn/d/UFI-TOOLS-UPDATE/",
  "alist_res": {
    "code": 200,
    "message": "success",
    "data": {
      "content": [
        { "name": "UFI-TOOLS_WEB_V4.1.5_20261029_1530.apk", "modified": "2026-10-29T15:30:00+08:00", "size": 21495808 }
      ],
      "total": 1
    }
  },
  "changelog": "v4.1.5<br>- 修复若干问题"
}
{ "error": "请求出错" }
```

### C.9 系统

```jsonc
// GET /api/version_info（免鉴权）
{ "app_ver": "4.1.5", "app_ver_code": "20261029", "model": "F50", "nickname": "F50", "accept_terms": true }
{ "error": "获取版本信息出错" }

// GET /api/need_token（免鉴权）
{ "need_token": true }
// GET /api/is_weak_token
{ "is_weak_token": true }
// GET /api/SELinux（免鉴权）
{ "selinux": "Permissive" }
// GET /api/device_id
{ "device_id": "5f0c2a6e-8b1d-4c3e-9a7f-2d4b6c8e0a1f" }
```

```jsonc
// POST /api/set_token  body: {"token":"AirPulse2026"}
{ "result": "success" }
{ "error": "请提供 token" }
{ "error": "token 需要至少8位" }
{ "error": "口令需要至少同时包含数字和字母" }

// POST /api/set_nickname  body: {"nickname":"客厅 F50"}
{ "result": "success" }
{ "error": "设置昵称出错" }

// POST /api/accept_terms
{ "result": "success" }
{ "error": "获取用户协议信息出错" }
```

```jsonc
// GET /api/usb_status：作为 USB 设备接电脑
{ "maxSpeed": 0, "details": { "typec_mode": "gadget", "gadget_speed": "USB 2.0 (480Mbps)", "devices": [] } }
// 外接 U 盘
{ "maxSpeed": 480, "details": { "typec_mode": "host", "gadget_speed": "unknown", "devices": [ { "path": "1-1", "product": "USB Flash Disk", "speed": 480 } ] } }
{ "error": "获取UsbDevices信息出错" }

// GET /api/connInfo（数字都是字符串）
{ "result": "success", "data": { "tcp": "23", "tcp_active": "9", "tcp_other": "14", "tcp6": "4", "udp": "12", "udp6": "3", "unix": "180" } }
```

```jsonc
// GET /api/get_custom_head（免鉴权）
{ "text": "<!-- [KANO_PLUGIN_START] 字距微调 -->\n<style>body{letter-spacing:.01em}</style>\n<!-- [KANO_PLUGIN_END] 字距微调 -->" }
{ "text": "" }
// POST /api/set_custom_head  body: {"text":"…"}
{ "result": "success" }
{ "error": "配置出错: 插件总容量超出限制: 6144KB/5120KB" }

// GET /api/get_theme（免鉴权，从未配置时为默认值）
{ "backgroundEnabled": "false", "backgroundUrl": "", "textColor": "rgba(255, 255, 255, 1)", "textColorPer": "100", "themeColor": "201", "colorPer": "67", "saturationPer": "100", "brightPer": "21", "opacityPer": "21", "blurSwitch": "true", "overlaySwitch": "true" }
// POST /api/set_theme
{ "result": "success" }
```

### C.10 官方快捷开关（goform）

```jsonc
// 读：原版每项单独请求，这里合并展示；F50 无电池，battery_* 为空串
{
  "usb_port_switch": "0",
  "performance_mode": "0",
  "indicator_light_switch": "1",
  "samba_switch": "1",
  "roam_setting_option": "off",
  "dial_roam_setting_option": "off",
  "usb_network_protocal": "0",
  "is_support_nfc_functions": "0",
  "web_wifi_nfc_switch": "",
  "sim_slot": "0",
  "restart_schedule_switch": "0",
  "restart_time": "03:00",
  "sleep_sysIdleTimeToSleep": "-1",
  "battery_value": "",
  "battery_vol_percent": ""
}
```

```jsonc
// 写：USB_PORT_SETTING、PERFORMANCE_MODE_SETTING、INDICATOR_LIGHT_SETTING、WIFI_NFC_SET、SAMBA_SETTING、
//     SET_CONNECTION_MODE、SET_USB_NETWORK_PROTOCAL、SET_SIM_SLOT、RESTART_SCHEDULE_SETTING、SET_WIFI_SLEEP_INFO、
//     CHANGE_PASSWORD、REBOOT_DEVICE、SHUTDOWN_DEVICE
{ "result": "success" }
// 失败的具体值未证实；原版只认 "success"
{ "result": "failure" }
```

### C.11 Mock 状态机建议

- **AT**：`ERROR` 返回 200；执行一条 AT 随机耗时 200–800 ms；同时只处理一条。
- **高级功能**：初始未开启，`root_shell` 返回 sock 不存在。`smbPath?enable=1` 成功后 30 s 内仍报 sock 不存在，之后 `whoami` 返回 `root`，`hasTTYD` 返回 `"200"`。`enable=0` 后立即恢复未开启。场景开关：「无线 ADB 未就绪时开启失败」。
- **无线 ADB**：`adb_wifi_setting` 写 `false` 时同时清空 `get_official_web_password`；`adb_alive` 按场景返回。
- **定时任务**：内存数组；`key = Date.now()`；同 id 覆盖；输出时省略等于默认值的字段；`time` 按后端规则处理（`HH:mm:ss` 截成 `HH:mm`，其它格式原样保存，用来复现「永不触发」）。
- **上传**：记录文件名和大小；`user_shell ls` 返回记录的文件列表；`delete_img`、`delete_all_uploads_data` 同步删除。
- **OTA**：`download_apk` 指向已上传的文件时，1–2 s 内 `percent` 从 0 涨到 100，再晚 200 ms 才变 `done`（复现竞态）；指向不存在的文件则 `error: "下载失败"`。`install_apk`：root 场景 2 s 后返回 `success`，ADB 场景 20 s 后返回；之后 8 s 内所有 `/api/*` 请求直接断开连接，恢复后 `version_info.app_ver_code` 变成新值；另设场景「安装失败」：恢复后版本不变，`tail` 日志返回 `Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: …]`。
- **测速**：`speedtest` 第 4 个并发返回 429；`proxy` 30 s 截断。
