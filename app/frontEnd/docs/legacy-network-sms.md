# 原版 UFI-TOOLS「Wi-Fi 热点 / 接入设备 / 网络与 SIM / 短信与转发」功能盘点

> 用途：AirPulse 用 React 重写「热点」「设备」「网络设置」「短信」页面时，照此对接接口、制作 Mock，并避开原版 bug。
> 依据：只读分析原版前端快照 `app/frontEnd/legacy-public/`（UFI-TOOLS v4.1.3）、Android 后端 Kotlin 源码、根目录 `API_Doc.md`。**未连接设备、未抓包**。
> 实时仪表盘、选网、锁频、锁小区、流量统计、数据开关见 `legacy-radio-dashboard.md`（下称《仪表盘文档》），本文只引用，不重复。

## 阅读约定

**出处缩写**（行号以当前仓库文件为准）

| 缩写 | 实际路径 |
| --- | --- |
| `main.js` / `requests.js` / `utils.js` | `app/frontEnd/legacy-public/script/*.js` |
| `index.html` / `zh.json` | `app/frontEnd/legacy-public/index.html`、`app/frontEnd/legacy-public/lang/zh.json` |
| `smsModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/smsForward/smsModule.kt` |
| `SmsPoll.kt` / `KanoSMTP.kt` / `KanoCURL.kt` / `KanoDingTalk.kt` / `KanoUtils.kt` / `BatteryReceiver.kt` | `app/src/main/java/com/minikano/f50_sms/utils/*.kt` |
| `ADBService.kt` | `app/src/main/java/com/minikano/f50_sms/ADBService.kt` |
| `baseDeviceInfoModule.kt` / `configModule.kt` / `reverseProxyModule.kt` / `mainModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/` 下的同名文件（含子目录） |
| `goform.ts` / `sms.ts` | 新前端 `app/frontEnd/src/api/goform.ts`、`app/frontEnd/src/model/sms.ts` |

**可信度标签**：**【代码】** 原版前端代码可证；**【后端】** Kotlin 源码可证；**【文档】** `API_Doc.md` 可证；**【推断】** 未经证实，需真机抓包确认。

**接口约定**（与《仪表盘文档》相同）

- goform 读：`GET /api/goform/goform_get_cmd_process?isTest=false&cmd=<逗号分隔>&multi_data=1&_=<毫秒>`，下文只写 `cmd=`。
- goform 写：`POST /api/goform/goform_set_cmd_process`，`application/x-www-form-urlencoded`，表单为 `goformId=<ID>&<参数…>&isTest=false&AD=<签名>`，下文只写 `goformId=` 和参数。**所有写操作都需要官方后台会话 + AD 签名**（`API_Doc.md` §3.13，只有 LOGIN 类例外）。新前端 `goform.ts` 的 `goformSet()` 已统一处理会话（`Kano-Cookie`）、AD、串行队列和「`result !== 'success'` 即抛错」，本文不再重复。
- goform 读的会话：原版只有主页轮询带了 `kano-cookie`，其余读取都不带（见 §1.1）。【推断】Wi-Fi 密码、客户端、APN、短信属于需要登录态的数据；新前端读取前先 `ensureDeviceSession()`，并统一带 `Kano-Cookie`（`goformGet()` 已如此）。
- UFI 自身接口（`/api/sms_forward_*`、`/api/set_nickname` 等）：需要 UFI 鉴权头（`kano-t` / `kano-sign` / `authorization`；`/api/version_info` 免鉴权）。`POST` 用 JSON body。成功返回 `{"result":"success"}`，失败返回 HTTP 500 `{"error":"…"}`。

---

## 0. 速览

### 0.1 功能 → 接口

| 功能 | 原版入口 | 读 | 写 | 原版确认 | 章节 |
| --- | --- | --- | --- | --- | --- |
| Wi-Fi 开关 / 2.4G·5G 切换 | 「WIFI设置」弹窗顶部下拉（关闭 / 2.4G / 5G 三选一） | `cmd=queryWiFiModuleSwitch,queryAccessPointInfo` | 关：`switchWiFiModule`；开 / 切：`switchWiFiChip` | 无，选中即提交 | §2.2 |
| SSID / 广播 / 加密 / 密码 / 最大接入 | 「WIFI设置」弹窗表单 | 同上（`ResponseList[]`） | `setAccessPointInfo` | 无 | §2.3 |
| Wi-Fi 二维码 | 同一弹窗底部 | `GET /api` + `QrImageUrl` | — | — | §2.4 |
| Wi-Fi 自动休眠 | 功能列表下拉（不支持时隐藏） | `cmd=sleep_sysIdleTimeToSleep` | `SET_WIFI_SLEEP_INFO` | 无 | §2.5 |
| NFC（碰一碰连 Wi-Fi） | 功能列表按钮（支持时才显示） | `cmd=is_support_nfc_functions`、`cmd=web_wifi_nfc_switch` | `WIFI_NFC_SET` | 无 | §2.6 |
| 性能模式 | 「高级功能」区按钮 | `cmd=performance_mode` | `PERFORMANCE_MODE_SETTING` | 无 | §2.7 |
| 接入设备列表 | 功能列表「接入设备」弹窗 | `cmd=station_list,lan_station_list,queryDeviceAccessControlList,hostNameList` | — | — | §3.1 |
| 设备改名 | 列表行的编辑图标 | — | `EDIT_HOSTNAME` | 输入浮层 | §3.3 |
| 拉黑 / 解封 | 列表行按钮 | 同 §3.1 | `setDeviceAccessControlList` | 无 | §3.4 |
| APN | 功能列表「APN设置」弹窗 | `cmd=<85 个 APN 字段>` | `APN_PROC_EX`（auto / save / delete / set_default） | 无（删除也无） | §4.1 |
| 移动数据开关 | 「数据开关」按钮 | `cmd=ppp_status` | `CONNECT_NETWORK` / `DISCONNECT_NETWORK` | 无 | §4.10、《仪表盘文档》§2.3 |
| 数据漫游 | 「网络漫游」按钮 | `cmd=roam_setting_option,dial_roam_setting_option` | `SET_CONNECTION_MODE` | 无 | §4.2 |
| SIM 卡槽 | 功能列表下拉（普通机型 / V50 两套） | `cmd=sim_slot`、`GET /api/version_info`（`model`） | `SET_SIM_SLOT` | 无 | §4.3 |
| SIM PIN | **无入口**（代码已注释） | `cmd=modem_main_state,…` | `ENTER_PIN`（注释代码） | — | §4.4 |
| USB 网络模式 | 功能列表下拉 | `cmd=usb_network_protocal` | `SET_USB_NETWORK_PROTOCAL` | 无 | §4.5 |
| 局域网 / DHCP | 「内网设置」弹窗 | `cmd=lan_ipaddr,lan_netmask,…` | `DHCP_SETTING` | 无（提交即重启） | §4.6 |
| 官方流量套餐 | 「流量管理」弹窗·官方 Tab | `cmd=flux_data_volume_limit_switch,…` | `DATA_LIMIT_SETTING` + `FLOW_CALIBRATION_MANUAL` | 无 | §4.7、《仪表盘文档》§7.3 |
| UFI 断网阈值 | 「流量管理」弹窗·UFI Tab | `GET /api/get_data_limit` | `POST /api/set_data_limit` | 无 | §4.7、《仪表盘文档》§7.4 |
| 指示灯 | 「指示灯」按钮 | `cmd=indicator_light_switch` | `INDICATOR_LIGHT_SETTING` | 无 | §4.8 |
| 重启 / 关机 | 「重启设备」「关闭电源」按钮 | 关机：`cmd=battery_value,battery_vol_percent` | `REBOOT_DEVICE` / `SHUTDOWN_DEVICE` | 连点 | §4.9、《仪表盘文档》§8 |
| 每日定时重启 | 「定时重启」弹窗 | `cmd=restart_schedule_switch,restart_time` | `RESTART_SCHEDULE_SETTING` | 无 | §4.9 |
| 恢复出厂 | **无** | — | 无接口证据 | — | §4.9 |
| 短信列表 | 「短信收发」弹窗（打开期间每 2 s 重拉） | `cmd=sms_data_total&page=0&data_per_page=500&mem_store=1&tags=100&order_by=order by id desc` | — | — | §5.1 |
| 标记已读 | 打开列表时自动全部标记 | — | `SET_MSG_READ`（逐条） | — | §5.3 |
| 发送 | 弹窗底部输入框 | — | `SEND_SMS` | 无 | §5.4 |
| 删除 | 每条的垃圾桶图标 | — | `DELETE_SMS` | 2 s 内连点 2 次 | §5.5 |
| 重发 | 发送失败条目上的图标 | — | `DELETE_SMS` + `SEND_SMS` | 无 | §5.6 |
| 转发总开关 | 「短信转发」弹窗顶部开关 | `GET /api/sms_forward_enabled` | `POST /api/sms_forward_enabled?enable=` | 无 | §6.3 |
| 转发渠道（SMTP / CURL / 钉钉） | 弹窗内三个 Tab 表单 | `GET /api/sms_forward_method` + `GET /api/sms_forward_{mail,curl,dingtalk}` | 同路径 `POST`（保存即发测试消息） | 无 | §6.4 |
| 转发规则（黑名单） | 「转发规则」按钮 | `GET /api/sms_forward_blacklist` | `POST /api/sms_forward_blacklist` | — | §6.6 |
| 设备别名 | 「设置别名」按钮 | `GET /api/version_info`（`nickname`） | `POST /api/set_nickname` | — | §6.7 |
| 电源状态通知 | 弹窗内开关 | `GET /api/power_status_forward_enabled` | `POST /api/power_status_forward_enabled?enable=` | 无 | §6.8 |
| 主动推送一条消息 | **原版界面未使用** | — | `POST /api/do_forward_msg` | — | §6.9 |

### 0.2 不在本文范围

- 选网、锁频、锁小区、实时流量统计，以及重启与关机的确认方式：《仪表盘文档》§4–§8。数据开关的完整说明在《仪表盘文档》§2.3，本文 §4.10 只做摘要并补充它与 UFI 断网阈值的冲突。
- USB 调试（`USB_PORT_SETTING`）、ADB 自启、文件共享（`SAMBA_SETTING`）、AT 指令、定时任务、修改官方后台密码（`CHANGE_PASSWORD`）、修改访问口令：属于开发者工具 / 鉴权，另行盘点。
- `GET /api/usb_status`（「USB状态」弹窗）：Type-C 口挂载的 USB 设备树（U 盘等），**不是**接入客户端列表（`main.js:7747-7793`）。

### 0.3 原版没有、`API_Doc.md` 和后端源码也找不到接口证据的功能

不要凭空实现。需要时先在官方后台（`:8080`）抓包确认 goformId。

| 范围 | 功能 |
| --- | --- |
| Wi-Fi | 信道、频宽、发射功率、WPS、2.4G 与 5G 同时开启、访客网络的 SSID / 密码（只有参数线索，见 §2.8） |
| 客户端 | 踢下线、在线时长、单设备流量 / 限速 |
| 网络 | 恢复出厂、MTU / MSS 写入（`mtu`、`tcp_mss` 只读到）、拨号模式切换（`ConnectionMode` 只见过 `auto_dial`） |
| 短信 | 存储容量、发送状态查询、SIM 卡内的短信、多 ID 批量删除 / 已读的参数格式 |

---

## 1. 原版通用机制与共性坑

### 1.1 写操作调用链【代码】

```
点击
 └ initRequestData()            本地是否保存了口令（main.js:612-625），没有则提示「请登录」
 └ login()                      requests.js:201-238
     GET  /api/get_cookie                 取设备上保存的会话
     GET  cmd=loginfo（带 kano-cookie）    == "ok" 则复用
     否则 POST /api/set_cookie {"cookie":""} → GET cmd=LD → POST goformId=LOGIN（或 LOGIN_MULTI_USER）
 └ postData(cookie, {goformId, …})  requests.js:301-319
     GET  cmd=Language,cr_version,wa_inner_version
     GET  cmd=RD
     POST goform_set_cmd_process          URLSearchParams，自动追加 isTest=false、AD
 └ res.json().result == 'success'
 └ 仅短信三操作（发送 / 删除 / 已读）：logout(cookie)，再算一次 AD → POST goformId=LOGOUT（requests.js:241-258）
```

- `postData` / `getRD` 想带 `Cookie` 头，但 `fetchWithTimeout` 用 `headers: { ...common_headers }` 覆盖了全部请求头（`requests.js:493`），而且浏览器本来就禁止脚本设置 `Cookie`。后端只把 `Kano-Cookie` 转成上游 Cookie（`reverseProxyModule.kt:58`、`:83`）。所以**原版写请求实际不带会话**。【推断】固件按来源识别会话（所有请求都由本机后端转发），原版因此仍能工作。新前端统一带 `Kano-Cookie`。
- 每个写操作至少 5 个请求；短信三操作再多 3 个（LOGOUT）。
- **不要照搬 LOGOUT**：注销会让同时进行的其它写操作和主页轮询丢掉会话（主页轮询随后因 `loginfo != ok` 自动重登）。`goform.ts` 已决定写完不注销。

### 1.2 读取【代码】

- `getData(params)`（`requests.js:321-332`）：追加 `isTest=false&_=<ts>`，5 s 超时，不带会话头。Wi-Fi、客户端、LAN、SIM、休眠、漫游等读取**都没带 `multi_data=1`**，仍能拿到多个字段（【推断】固件宽容）。新前端统一带上（`goformGet()` 多字段时自动加）。
- 原版在这些读取之前不调用 `login()`，依赖主页轮询维持的会话。

### 1.3 「快捷开关」的统一交互【代码】

指示灯、漫游、NFC、性能模式（以及《仪表盘文档》里的数据开关）都是同一套写法：

1. 页面初始化（或登录后的 `initRenderMethod`，`main.js:455-494`）读一次状态；按钮背景为 `--dark-btn-color-active` 表示「开」。
2. 点击时用**初始化时读到的旧值**取反提交，不重新读取。
3. 成功 toast「操作成功」并重读；失败「操作失败」；网络异常多数**静默**（`catch` 里只有注释）。
4. 未登录时按钮置灰，点击提示「请登录」。

坑：在官方后台或定时任务里改过状态后，原版按钮会提交错误的目标值。新前端提交前以最新状态为准（或乐观更新后重读）。

下拉类（Wi-Fi 频段、休眠、USB 网络模式、SIM 卡槽）都是「选中即提交」，都没有确认；除休眠外，提交前都会 toast「更改中，请稍后」（颜色 `#BF723F`）。

### 1.4 后端反代对 GET 参数的处理【后端】

`reverseProxyModule.kt:36-37` 把**已解码**的 query 参数直接拼成 `k=v&k=v` 发给上游，不重新编码。所以 goform GET 参数值里不能出现 `&`、`=`、`#`、`%`；`order_by=order by id desc` 这种带空格的值原版可用。POST 表单体原样转发（`:65-67`），不受影响。

### 1.5 常用提示文案（`zh.json`）

| key | 文案 | 用在 |
| --- | --- | --- |
| `toast_oprate_success` / `toast_oprate_failed` | 操作成功 / 操作失败 | 快捷开关、下拉 |
| `toast_oprate_success_reboot` | 操作成功！重启生效 | 性能模式、USB 网络模式 |
| `toast_op_success_reconnect_wifi` | 操作成功，请重新连接WiFi！ | Wi-Fi 频段切换、热点参数 |
| `toast_changing` | 更改中，请稍后 | 下拉提交前 |
| `toast_login_failed_check_network` | 登录失败，请检查密码 | `login()` 返回空 |
| `toast_set_success` / `toast_set_failed` | 设置成功 / 设置失败 | 表单类 |
| `toast_set_success_reboot` | 设置成功! 设备正在重启~ | DHCP |
| `toast_save_success` / `toast_save_failed` | 保存成功 / 保存失败 | 改名、APN、转发规则、别名 |
| `client_mgmt_fetch_error` | 获取数据失败，请检查网络连接 | 客户端、短信列表读取失败 |

---

## 2. Wi-Fi 热点

### 2.1 读取：`cmd=queryWiFiModuleSwitch,queryAccessPointInfo`

- 调用点：页面初始化和切换成功后的 `initWIFISwitch()`（`main.js:1432-1466`）；打开「WIFI设置」弹窗时的 `initWIFIManagementForm()`（`main.js:2371-2434`）。都没带 `multi_data`。
- **响应键不是 cmd 名**：顶层是 `WiFiModuleSwitch` 和 `ResponseList`【代码 `main.js:1442`、`:2373`】。`API_Doc.md` §3.13 只列了子字段。

顶层：

| 字段 | 取值 | 原版用法 | 出处 |
| --- | --- | --- | --- |
| `WiFiModuleSwitch` | `"1"` / `"0"` | `== "1"` 才显示参数区并识别当前频段 | `main.js:1452`、`:2381` |
| `ResponseList` | 数组，每个 AP 一项 | 找 `AccessPointSwitchStatus == '1'` 的项 | `main.js:1454-1459`、`:2383-2385` |

`ResponseList[i]`：

| 字段 | 格式 / 取值 | 原版用法 | 出处 |
| --- | --- | --- | --- |
| `AccessPointSwitchStatus` | `"1"` / `"0"` | `== '1'` 视为当前启用的 AP；有多项为 1 时**最后一项**生效 | `main.js:1456`、`:2384` |
| `ChipIndex` | `"0"`；另一值推断为 `"1"` | `== "0"` → `chip1`（2.4G），否则 `chip2`（5G）；回填隐藏字段 | `main.js:1457`、`:2395` |
| `AccessPointIndex` | 推断 `"0"` | 回填隐藏字段；【推断】0 = 主 AP，1 = 访客 AP | `main.js:2394` |
| `SSID` | 文本 | 回填 | `main.js:2399` |
| `Password` | **UTF-8 文本的 Base64**【代码】【文档】 | `decodeBase64()` 后回填明文 | `main.js:2397`、`utils.js:185-199` |
| `AuthMode` | `OPEN` / `WPA2PSK` / `WPA3PSK` / `WPA2PSKWPA3PSK`（原版下拉的 4 个值） | 选中同值选项；`OPEN` 时隐藏密码和最大接入 | `main.js:2412-2422`、`index.html:973-987` |
| `ApBroadcastDisabled` | `"0"` / `"1"`（也可能是 number） | `.toString() == '0'` → 勾选「广播SSID」 | `main.js:2398` |
| `ApMaxStationNumber` | 数字字符串 | 回填 | `main.js:2396` |
| `QrImageUrl` | 相对路径（格式未知） | 拉二维码图片（§2.4） | `main.js:2401` |

- 【推断】每项里大概率还有 `EncrypType`、`ApIsolate`（写接口有同名参数），原版不读。
- 【推断】F50 同一时间只启用一个芯片的主 AP：原版 UI 是「关闭 / 2.4G / 5G」三选一。
- 字段值类型不稳定（原版专门对 `ApBroadcastDisabled` 做了 `.toString()`），新前端一律 `String(x)` 后再比较。

### 2.2 开关与频段切换（`#WIFI_SWITCH`）

- 位置：「WIFI设置」弹窗顶部下拉（`index.html:941-945`），右侧小字「此选项即时更改无需确认。」。选项：`0` = WIFI:关闭，`chip1` = WIFI:2.4G，`chip2` = WIFI:5G。
- 显示（`main.js:1452-1464`）：`WiFiModuleSwitch == "1"` 时选中启用 AP 对应的 chip，并显示下方参数区 `#wifiInfo`；否则选 `0` 并隐藏参数区。
- 提交（`changeWIFISwitch`，`main.js:1469-1515`）：先 toast「更改中，请稍后」并禁用下拉，然后
  - `0` → `goformId=switchWiFiModule&SwitchOption=0`
  - `chip1` / `chip2` → `goformId=switchWiFiChip&ChipEnum=chip1|chip2&GuestEnable=0`
  - 从「关闭」直接选 2.4G / 5G 也**只发 `switchWiFiChip`**，不先发 `SwitchOption=1`【代码】。原版（包括定时任务模板 `main.js:5608-5621`）从来没有发过 `SwitchOption=1`。【推断】`switchWiFiChip` 会顺带打开模块。
  - 响应回来后**再等 1 s** 才处理：成功 toast「操作成功，请重新连接WiFi！」并重读；否则「操作失败」；最后解禁下拉。
- 坑：
  1. 经 Wi-Fi 访问时切换会断线，请求超时抛异常 → `catch` 为空，**下拉一直保持禁用**，也没有任何提示。
  2. 打开弹窗只刷新表单、不刷新这个下拉（它只在页面初始化和切换成功后刷新），外部改动后显示会过期。
  3. 没有确认；对 Wi-Fi 接入的用户来说，关闭 Wi-Fi 等于失联，只能走 USB 恢复。
- 新前端建议：用「关闭 / 2.4G / 5G」分段控件；判断当前浏览器是否经 Wi-Fi 接入（`/api/baseDeviceInfo` 的 `client_ip` 是否出现在 §3 的 `station_list[].ip_addr` 里），是则强确认并说明「连接会中断」；请求超时按「可能已生效」处理，提示重新连接后刷新。

### 2.3 热点参数：`goformId=setAccessPointInfo`

表单在 `index.html:924-1034`，提交函数 `handleWIFIManagementFormSubmit`（`main.js:2446-2529`）。

| 界面 | 表单 name | 提交参数 | 转换规则 | 出处 |
| --- | --- | --- | --- | --- |
| （隐藏） | `AccessPointIndex` | `AccessPointIndex` | 回填当前 AP，默认 `0`；`Number()` | `main.js:2394`、`:2492-2494` |
| （隐藏） | `ChipIndex` | `ChipIndex` | 回填，默认 `0`；`Number()` | `main.js:2395` |
| （隐藏） | `ApIsolate` | `ApIsolate` | **固定 `0`，从不回填** → 每次保存都会关闭 AP 隔离 | `index.html:937`、`main.js:2469` |
| SSID | `SSID` | `SSID` | `trim()`；为空时提交 `''`（**不校验非空，也不校验 32 字节上限**） | `main.js:2476-2478` |
| 广播SSID（checkbox，默认勾选） | `ApBroadcastDisabled` | `ApBroadcastDisabled` | 勾选 → `0`（广播）；不勾选 → `1`（隐藏 SSID） | `main.js:2483-2485` |
| 安全模式 | `AuthMode` | `AuthMode` + `EncrypType` | `OPEN` → `EncrypType=NONE`；其它一律 `CCMP` | `main.js:2479-2482` |
| 密码（「显示密码」勾选框切换 type） | `Password` | `Password` | `trim()` 后 **Base64（UTF-8，`encodeBase64`）**；`OPEN` 时删除该参数 | `main.js:2486-2489`、`:2499-2501`、`utils.js:201-213` |
| 最大接入（number，默认 10，`min=1`） | `ApMaxStationNumber` | `ApMaxStationNumber` | `Number()`；清空后变成 `0` | `main.js:2491-2495` |

请求体示例（5G、WPA2、密码 `12345678`）【代码推断】：

```
goformId=setAccessPointInfo&SSID=ZTE-F50-5G&AuthMode=WPA2PSK&EncrypType=CCMP&Password=MTIzNDU2Nzg%3D
&ApMaxStationNumber=10&ApBroadcastDisabled=0&ApIsolate=0&ChipIndex=1&AccessPointIndex=0&isTest=false&AD=…
```

`URLSearchParams` 会把 Base64 里的 `=`、`+`、`/` 百分号编码，固件解码后得到原 Base64。

校验（只在非 `OPEN` 时生效，`main.js:2499-2511`）：

| 条件 | 提示 | 实际效果 |
| --- | --- | --- |
| 密码为空 | 请输入密码 | 正常 |
| `data.Password.length < 8` | 密码至少8位数 | **判断的是 Base64 之后的长度**：明文 4–7 位编码后 ≥ 8 个字符，照样通过 |
| `data.ApMaxStationNumber.length <= 0` | 最大接入必须大于0 | 此时已是 number，没有 `.length`，**永远不会触发** |

结果：成功 toast「操作成功，请重新连接WiFi！」并关闭弹窗。失败时 `throw t('toast_oprate_failed_check_network')`（抛的是字符串），`catch` 只执行 `console.error(e.message)`，**失败没有任何提示**。

坑与新前端规则：

1. 校验明文密码：WPA2 / WPA3 为 8–63 个可打印 ASCII 字符，或 64 位十六进制【推断：802.11i 通用规则】。
2. 不要 `trim` 密码（WPA 密码允许首尾空格）；SSID 校验 1–32 字节（UTF-8）。
3. `ApIsolate`：能从 `ResponseList` 回读就回填，否则保持 `0`，不要每次重置。
4. 固件返回的 `AuthMode` 不在 4 个选项里时（例如【推断】`WPAPSKWPA2PSK`），原版下拉显示空白并提交 `AuthMode=''`。新前端把未知值作为只读选项保留。
5. 最大接入：原版没有上限；新前端限制 ≥ 1，上限需真机确认。
6. 改 SSID / 密码 / 加密 / 隐藏都会让 Wi-Fi 客户端断线，与 §2.2 一样需要确认。

### 2.4 二维码

- `fetch('/api' + item.QrImageUrl)` → blob → objectURL（`main.js:2401-2410`），每次打开弹窗请求一次。
- 【后端】UFI 后端只把 `/api/goform/...` 反代到官方后台（`reverseProxyModule.kt:31`、`mainModule.kt:31-62`）。`QrImageUrl` 若不是 `/goform/` 开头，`/api/<路径>` 没有对应路由，**二维码大概率加载失败**（取决于真机返回的路径，【推断】）。
- 新前端建议：本地生成 Wi-Fi 二维码，内容为 `WIFI:T:WPA;S:<SSID>;P:<密码>;H:<true|false>;;`（OPEN 用 `T:nopass` 且省略 `P`；`\ ; , : "` 前加反斜杠转义），二维码库本地打包。

### 2.5 Wi-Fi 自动休眠

- 位置：功能列表区下拉 `#SLEEP_TIME`（`index.html:122-131`）。选项值（分钟）：`-1` 不休眠、`5`、`10`、`20`、`30`、`60`、`120`。
- 读：`cmd=sleep_sysIdleTimeToSleep`（`main.js:7247-7268`）；值为 `""` 时隐藏下拉（【推断】机型不支持）。
- 写：`goformId=SET_WIFI_SLEEP_INFO&sleep_sysIdleTimeToSleep=<值>`，选中即提交；成功「操作成功」并重读，失败「操作失败」（`main.js:7271-7298`）。
- 【文档】`API_Doc.md` 称之为「WiFi 自动休眠时间」；【推断】含义是无客户端连接持续 N 分钟后关闭 Wi-Fi。
- 坑：读到的值不在 7 个选项内时下拉显示异常；`target.disabed` 拼写错误，未登录时禁用无效。

### 2.6 NFC（碰一碰连 Wi-Fi）

- 按钮 `#NFC` 默认隐藏（`index.html:105`）；`cmd=is_support_nfc_functions` 为真且 `Number() != 0` 时才显示（`main.js:3797-3850`）。
- 读：`cmd=web_wifi_nfc_switch`（单独一次请求）；写：`goformId=WIFI_NFC_SET&web_wifi_nfc_switch=<0|1>`。快捷开关模式（§1.3）。
- 【推断】从键名看是 NFC 碰一碰连接 Wi-Fi。
- 坑：`web_wifi_nfc_switch` 缺失时 `.toString()` 抛异常（被外层 `catch` 吞掉），按钮不可用。

### 2.7 性能模式（原版唯一和「功率」沾边的开关）

- 「高级功能」区按钮 `#PERF`（`index.html:1699`）。读 `cmd=performance_mode`，写 `goformId=PERFORMANCE_MODE_SETTING&performance_mode=<0|1>`（`main.js:1209-1246`）；成功提示「操作成功！重启生效」。
- 原版和 `API_Doc.md` 都只叫它「性能模式」，**没有说明是否影响 Wi-Fi 发射功率**。原版没有任何 Wi-Fi 功率 / 覆盖范围设置。
- 坑：定时任务模板写成了 `goformId: 'PERFORMANCE_MODE'`（`main.js:5594-5597`），与按钮不一致，【推断】定时任务那个是错的。

### 2.8 原版没做、但有参数线索的能力

| 能力 | 线索 | 结论 |
| --- | --- | --- |
| 访客网络 | `switchWiFiChip` 的 `GuestEnable`（原版固定 `0`）；`setAccessPointInfo` 的 `AccessPointIndex` | 【推断】`GuestEnable=1` 开访客、`AccessPointIndex=1` 是访客 AP；访客 SSID / 密码的读写格式没有证据，需抓包 |
| AP 隔离 | `setAccessPointInfo` 的 `ApIsolate`【代码】【文档】 | 参数确实存在，取值 0 / 1【推断】。先确认 `ResponseList` 能否回读该字段再做 |
| 接入白名单 | `setDeviceAccessControlList` 的 `WhiteMacList` / `WhiteNameList` / `AclMode` | 见 §3.5 |

---

## 3. 已连接设备

### 3.1 读取：`cmd=station_list,lan_station_list,queryDeviceAccessControlList,hostNameList`

- 打开「接入设备」弹窗或点弹窗里的「刷新」时读一次（`main.js:2567-2576`、`index.html:1124`），**不轮询**；没带 `multi_data`。
- 响应顶层键【代码 `main.js:2580`】：

| 键 | 来自 cmd | 格式 | 原版用途 |
| --- | --- | --- | --- |
| `station_list` | `station_list` | 数组（没有设备时也可能是 `""`，原版用 `&& .length` 判断） | 无线客户端 |
| `lan_station_list` | `lan_station_list` | 同上 | 有线客户端；【推断】F50 没有网口，即 USB 网卡（RNDIS / ECM）接入的电脑 |
| `AclMode` | `queryDeviceAccessControlList` | 字符串 | 拉黑 / 解封时原样回传 |
| `BlackMacList` | 同上 | `;` 分隔的 MAC 串 | 黑名单 |
| `BlackNameList` | 同上 | `;` 分隔的名称串，与 `BlackMacList` **按下标对应** | 黑名单名称 |
| `WhiteMacList` / `WhiteNameList` | 同上 | 【推断】同格式 | 原版不读 |
| `devices` | `hostNameList` | `[{ "mac": "...", "hostname": "..." }]` | 用户改过的名称，优先于 station 里的 `hostname` |

`station_list[i]` / `lan_station_list[i]` 原版只读 `hostname`、`ip_addr`、`mac_addr` 三个字段【代码 `main.js:2593`、`:2619`】。在线时长、流量、信号等字段原版不读，是否存在未知。

### 3.2 列表渲染【代码 `main.js:2592-2673`】

- 每行：主机名称（点击复制）+ 编辑图标、MAC地址、IP地址、接入类型（`station_list` →「无线」，`lan_station_list` →「有线」），右侧「🚫 拉黑」按钮；下方「黑名单」区每行是「✅ 解封」。
- 名称：`devices.find(i => i.mac == mac_addr)?.hostname || hostname`。
- 空列表显示「暂无设备」；读取异常 toast「获取数据失败，请检查网络连接」。
- 坑：
  1. 存在 `devices` 时名称**未转义**直接进 innerHTML（XSS）；名称含 `'` 时拼进 `onclick` 字符串会破坏脚本。
  2. MAC 用 `==` 比较，区分大小写。新前端统一转小写再比较。
  3. 不轮询；新前端在页面可见时每 5–10 s 刷新即可。
  4. 可以用 `/api/baseDeviceInfo` 的 `client_ip` 标出「本机」，拉黑时特殊提示（原版没有）。

### 3.3 改名：`goformId=EDIT_HOSTNAME`

- 点编辑图标 → 自制浮层（`main.js:2680-2721`）：只读的 `MAC: xx`、名称输入框（预填当前名称）、「确定 / 取消」。
- 校验：`trim()` 后为空 →「主机名不能为空」；没有长度和字符限制。
- 请求（`requests.js:712-720`）：`goformId=EDIT_HOSTNAME&mac=<MAC>&hostname=<名称>`。
- 成功 toast「保存成功」并重读列表；失败「保存失败」。
- 【推断】改名写进 `hostNameList`（即 `devices`），`station_list` 里的原始 `hostname` 不变。

### 3.4 拉黑 / 解封：`goformId=setDeviceAccessControlList`

请求（`main.js:2723-2754`）：

```
goformId=setDeviceAccessControlList&AclMode=<读到的原值>&WhiteMacList=&BlackMacList=<;分隔>&WhiteNameList=&BlackNameList=<;分隔>
```

- 拉黑：`BlackMacList = [该 MAC, ...原黑名单 MAC].join(';')`，`BlackNameList = [escapeHtml(hostname), ...原黑名单名称].join(';')`（`main.js:2611`、`:2637`）。
- 解封（`main.js:2644-2667`）：
  - MAC：`blackMacList.filter(i => item != i)`，正确；
  - 名称：`blackMacList.filter(i => blackNameList[index] != i)`，**bug：拿 MAC 列表去过滤名称，结果把 MAC 列表写进了 `BlackNameList`**。
- 结果：成功「操作成功」，失败「操作失败」，异常「请求数据失败，请检查网络连接」；完成后重读。
- 坑：
  1. 解封 bug（见上）。新前端以 MAC 为主键维护 `[{mac, name}]`，提交时按同一顺序生成两个串。
  2. 白名单两项**每次都被清空**，`AclMode` 原样回传——设备当前若是白名单模式，拉黑会把白名单清掉。
  3. 黑名单区的渲染条件是 `blackMacList.length && blackNameList.length`（`main.js:2644`）：`BlackNameList` 为空串时整个黑名单不显示，用户无法解封。
  4. 原串若以 `;` 结尾，拼接后出现空项；名称里含 `;` 会让两列错位；提交的名称是 `escapeHtml` 之后的串（`&amp;` 之类的实体会被写进设备）。
  5. 没有确认；拉黑当前浏览器所在的设备会让自己掉线。
- 【推断】`AclMode` 取值没有仓库证据；中兴系固件常见 `0` = 不过滤、`1` = 白名单、`2` = 黑名单，需抓包确认。第一版保持原版行为（原样回传）。

### 3.5 白名单（原版没做）

参数存在【代码】【文档】，原版没有界面。要做的话先确认 `AclMode` 取值和切到白名单后的固件行为（白名单模式下，名单外的设备会立刻断开，包括自己）。

### 3.6 不支持的功能

踢下线、在线时长、单设备流量：原版没有，`API_Doc.md` 和后端也没有接口证据。主页的 `wifi_access_sta_num` 只是无线连接数（《仪表盘文档》§1.2 #27）。

---

## 4. 网络与 SIM 设置

### 4.1 APN

#### 4.1.1 读取：`getAPNData()`

- `requests.js:618-628`：`cmd=<85 个字段>&multi_data=1`。打开「APN设置」弹窗时读一次，每次操作成功后重读。字段为 `apn_interface_version`、`APN_config0`…`APN_config19`、`ipv6_APN_config0`…`ipv6_APN_config19`，以及 `apn_m_profile_name, profile_name, apn_wan_dial, apn_select, apn_pdp_type, apn_pdp_select, apn_pdp_addr, index, apn_Current_index, apn_auto_config, apn_ipv6_apn_auto_config, apn_mode, apn_wan_apn, apn_ppp_auth_mode, apn_ppp_username, apn_ppp_passwd, dns_mode, prefer_dns_manual, standby_dns_manual, apn_ipv6_wan_apn, apn_ipv6_pdp_type, apn_ipv6_ppp_auth_mode, apn_ipv6_ppp_username, apn_ipv6_ppp_passwd, ipv6_dns_mode, ipv6_prefer_dns_manual, ipv6_standby_dns_manual, apn_num_preset, wan_apn_ui, profile_name_ui, pdp_type_ui, ppp_auth_mode_ui, ppp_username_ui, ppp_passwd_ui, dns_mode_ui, prefer_dns_manual_ui, standby_dns_manual_ui, ipv6_wan_apn_ui, ipv6_ppp_auth_mode_ui, ipv6_ppp_username_ui, ipv6_ppp_passwd_ui, ipv6_dns_mode_ui, ipv6_prefer_dns_manual_ui, ipv6_standby_dns_manual_ui`（`API_Doc.md` 写约 90 个，实际 85 个）。
- 原版实际用到的字段：

| 字段 | 用途 | 出处 |
| --- | --- | --- |
| `apn_mode` | `"auto"` / `"manual"`，决定单选状态和显示哪组控件 | `main.js:7484-7503` |
| `APN_config0`…`19` | 手动配置列表；空串跳过 | `main.js:7522-7536` |
| `ipv6_APN_config<i>` | 「修改」时 `split('($)')`，只打日志 | `main.js:7639` |
| `apn_wan_apn` | 「当前APN」；查看框的 APN | `main.js:7494`、`:7316` |
| `profile_name` → `m_profile_name` → `profile_name_ui` | 「当前APN」后括号里的配置名 | `main.js:7494` |
| `apn_m_profile_name` → `m_profile_name` → `profile_name` | 查看框配置名、自动模式下拉文字 | `main.js:7313`、`:7510` |
| `ppp_username_ui` → `apn_ppp_username`；`ppp_passwd_ui` → `apn_ppp_passwd`；`ppp_auth_mode_ui` → `apn_ppp_auth_mode`；`apn_pdp_type`；`apn_ipv6_wan_apn` | 查看框 | `main.js:7316-7329` |

- `m_profile_name`、`apn_auto_profile` 原版读取了，但**不在 cmd 列表里**，恒为 `undefined`【代码】。`apn_Current_index`、`index`、`apn_num_preset` 请求了但没用。

#### 4.1.2 `APN_config<i>` 字符串格式

以 `($)` 分隔。下标含义【代码 `main.js:7524-7528`、`:7638-7648`】：

| 下标 | 含义 | 示例 |
| --- | --- | --- |
| 0 | 配置名称 | `中国移动` |
| 1 | APN | `cmnet` |
| 2 | 原版不读；【推断】`apn_select`（manual / auto） | `manual` |
| 3 | 原版不读；【推断】拨号号码 | `*99#` |
| 4 | 鉴权方式，读出后 `toLowerCase()`：`none` / `pap` / `chap` | `none` |
| 5 | 用户名 | （空） |
| 6 | 密码 | （空） |
| 7 | PDP 类型：`IP` / `IPv6` / `IPv4v6` | `IPv4v6` |
| 8 起 | 原版不读；【推断】pdp_select、pdp_addr、dns_mode、首选 / 备用 DNS | |

`ipv6_APN_config<i>` 结构【推断】相同。新前端只依赖下标 0、1、4、5、6、7。

#### 4.1.3 界面

弹窗 `index.html:2101-2159`：顶部说明（`apn_title_info`：「接入点名称(APN)用于您设备连接运营商网络的名称，该信息会根据您的sim卡自动匹配。如果无法上网可以尝试修改这组参数，参数作用请咨询当地运营商。」）；「当前APN」行；「自动APN」单选：自动 / 手动。

- 自动：配置下拉（只有一个选项，文字为当前配置名）+「查看」→「APN信息」只读框（配置名称、APN、用户名、**密码明文**、鉴权方式、PDP类型，`index.html:2160-2200`）。
- 手动：配置下拉 `#manualProfile`（列出非空的 `APN_config`，选项值与文字都是配置名）+「添加 / 修改 / 删除」。
- 底部「提交」：切换自动 / 手动；手动时把所选配置设为默认（§4.1.6）。

#### 4.1.4 新增 / 修改：`goformId=APN_PROC_EX&apn_action=save`

编辑框（`index.html:2201-2249`）：配置名称、APN、用户名、密码（明文 `type=text`）、鉴权方式（NONE / CHAP / PAP → `none` / `chap` / `pap`）、PDP类型（IPv4 → `IP` / `IPv6` / `IPv4v6`）。新增时默认鉴权 `none`、PDP `IP`（`main.js:7606-7613`）。

校验：配置名称和 APN `trim()` 后都不能为空，否则「请填写 配置名称 & APN名称 & 鉴权方式 & PDP类型」（实际只校验前两项）。

请求（`getAPNEditFormData`，`main.js:7382-7461`；`saveAPNProfile`，`requests.js:643-651`）：

```
goformId=APN_PROC_EX&apn_mode=manual&apn_action=save&index=<见下>
&profile_name=<名称>&wan_dial=*99#&apn_wan_dial=*99#&apn_select=manual
&apn_pdp_type=<IP|IPv6|IPv4v6>&pdp_type=<同>&apn_pdp_select=auto&apn_pdp_addr=&pdp_select=auto&pdp_addr=
── IPv4 组（PDP 为 IP 或 IPv4v6 时）──
&apn_wan_apn=<APN>&wan_apn=<APN>&apn_ppp_auth_mode=<none|pap|chap>&ppp_auth_mode=<同>
&apn_ppp_username=<用户名>&ppp_username=<同>&apn_ppp_passwd=<密码>&ppp_passwd=<同>
&dns_mode=auto&prefer_dns_manual=&standby_dns_manual=
── IPv6 组（PDP 为 IPv6 或 IPv4v6 时）──
&apn_ipv6_wan_apn=<APN>&ipv6_wan_apn=<APN>&apn_ipv6_ppp_auth_mode=<同上>&ipv6_ppp_auth_mode=<同上>
&apn_ipv6_ppp_username=<同上>&ipv6_ppp_username=<同上>&apn_ipv6_ppp_passwd=<同上>&ipv6_ppp_passwd=<同上>
&ipv6_dns_mode=auto&ipv6_prefer_dns_manual=&ipv6_standby_dns_manual=
```

- `index`：新增 = 当前下拉选项个数（追加到末尾）；修改 = 下拉 `selectedIndex`。
- IPv4、IPv6 两组共用同一套 APN / 鉴权 / 账号，原版不支持分别填写；DNS 固定自动。
- 成功「保存成功」→ 回到 APN 弹窗并重读；失败「保存失败」。
- 【推断】保存只写配置，不会切换正在使用的 APN，需要再点「提交」设为默认。

#### 4.1.5 删除：`goformId=APN_PROC_EX&apn_action=delete`

`deleteAPNProfile(index)`（`requests.js:631-640`）→ `goformId=APN_PROC_EX&index=<selectedIndex>&apn_mode=manual&apn_action=delete`。**没有确认**。成功「删除成功」并重读，失败「删除失败」。

#### 4.1.6 自动 / 手动切换（底部「提交」）

`switchAPNAuto`（`requests.js:654-669`，调用处 `main.js:7687-7727`）：

- 自动：`goformId=APN_PROC_EX&apn_mode=auto`
- 手动：`goformId=APN_PROC_EX&apn_mode=manual&apn_action=set_default&set_default_flag=1&apn_pdp_type=&index=<selectedIndex>`（`apn_pdp_type` 固定为空串）
- 选了手动但下拉没有选项 →「请选择APN配置」。成功「操作成功」并重读，失败「操作失败」。
- 【推断】切换 APN 会重建数据连接、短暂断网；原版没有确认。

#### 4.1.7 坑

1. **下拉序号 ≠ 配置槽位号**：下拉跳过了空的 `APN_config<i>`，但修改 / 删除 / 设默认都把 `selectedIndex` 当 `index` 提交；中间有空槽时会操作到别的配置。选中当前配置时又把槽位号 `i` 当成了下拉序号（`main.js:7532-7540`）。新前端让每个选项记住真实槽位 `i`；新增时用第一个空槽【推断】。
2. 当前配置按**名称**匹配，重名时不准。【推断】`apn_Current_index` 可以直接定位当前槽位。
3. 没处理 `apn_num_preset`：【推断】前 N 个是运营商预设，固件可能拒绝修改 / 删除。
4. 响应里缺少 `ipv6_APN_config<i>` 这个键时，「修改」会抛异常（`main.js:7639`，空串不会）；`ppp_auth_mode_ui` 缺失，或它为空串且 `apn_ppp_auth_mode` 也缺失时，「查看」会抛异常（`main.js:7325`）。
5. 名称或 APN 中出现 `($)` 会破坏分隔格式，新前端应禁止。
6. 密码在查看框和编辑框里都是明文，新前端用 `PasswordInput`。

### 4.2 数据漫游

- 按钮 `#ROAM`「网络漫游」（`index.html:109`），快捷开关模式（§1.3），`main.js:1558-1601`。
- 读：`cmd=roam_setting_option,dial_roam_setting_option`；`dial_roam_setting_option` 非空时覆盖 `roam_setting_option`。取值 `"on"` / `"off"`，`== 'on'` 时按钮高亮。
- 写：`goformId=SET_CONNECTION_MODE&ConnectionMode=auto_dial&roam_setting_option=<on|off>&dial_roam_setting_option=<同值>`（两个字段同时写）。
- 坑：`ConnectionMode` 固定为 `auto_dial`。【推断】设备原来若是手动拨号，切一次漫游就被改回自动拨号。
- 新前端建议：开启时提示可能产生漫游费用。

### 4.3 SIM 卡槽

- 机型判断（`main.js:3758-3763`）：`GET /api/version_info` 的 `model`，`toLowerCase() == 'v50'` 用 4 选项下拉，否则用 SIM1 / SIM2 下拉。
- **双卡支持检测被注释掉了**（`main.js:3765-3773`），所有机型都会显示下拉，包括单卡机型。
- 选项（`index.html:148-160`）：

| 下拉 | 值 → 文案 |
| --- | --- |
| `#SIM_CARD_TYPE`（普通机型） | `0` → SIM1，`1` → SIM2 |
| `#SIM_CARD_TYPE_V50` | `0` → 移动，`1` → 电信，`2` → 联通，`11` → 外置 |

- 读：`cmd=sim_slot`，与选项值相等的项被选中；不匹配（例如 `"12"`）时停在第一项，**显示错误的当前卡槽**。读完会刷新 QCI（《仪表盘文档》§2.5）。
- 写：`goformId=SET_SIM_SLOT&sim_slot=<值>`，选中即提交，先 toast「更改中，请稍后」；成功「操作成功」，失败「操作失败」；之后重读并刷新 QCI（`main.js:3852-3879`）。没有确认。
- 定时任务模板（`main.js:5653-5675`）的映射与下拉一致：切移动 `0`、切电信 `1`、切联通 `2`、切外置 `11`、切 SIM1 `0`、切 SIM2 `1`。
- `sim_slot` 的完整值域见《仪表盘文档》§1.2 #8（含 `12`，含义未知）。
- 新前端建议：显示条件用主页轮询里的 `dual_sim_support == '1'` 或 `model` 为 v50【推断】；切卡会断网并重新注册，需要确认；当前值不在选项内时显示「未知卡槽（值）」。

### 4.4 SIM PIN（原版无入口）

- 相关代码全部被注释（`main.js:8326-8425`）。作者注释说明原因：官方后台对 PIN 次数的判定有问题，PIN 次数用完后提示输入 PUK，换卡也不会恢复，只能恢复出厂，所以不实现。
- 遗留的接口线索：
  - 读：`getSimPinStatus()`（`requests.js:682-697`，未被调用）→ `cmd=modem_main_state,mc_modem_main_state,puknumber,pinnumber,sim_pinnumber`；归一化为 `modem_main_state || mc_modem_main_state`、`pinnumber || sim_pinnumber`、`puknumber`。
  - 状态值（注释代码）：`modem_waitpin` = 需要输入 PIN；`modem_waitpuk` 或 `pinnumber <= 0` = 需要 PUK。
  - 写（注释代码）：`goformId=ENTER_PIN&PinNumber=<PIN>`，PIN 至少 4 位。
- 新前端建议：只做只读提示（「SIM 卡已锁定，需要 PIN / PUK，请到官方后台处理」），不做输入。

### 4.5 USB 网络模式

- 功能列表下拉 `#USB_TYPE`（`index.html:142-146`）：`0` →「USB上网:自动」，`1` → RNDIS，`2` → CDC-ECM。
- 读：`cmd=usb_network_protocal`（注意拼写是 protocal），与选项值相等的项被选中（`main.js:1380-1401`）。
- 写：`goformId=SET_USB_NETWORK_PROTOCAL&usb_network_protocal=<0|1|2>`，选中即提交；toast「更改中，请稍后」→「操作成功！重启生效」/「操作失败」，之后重读（`main.js:1403-1429`）。没有确认。
- 【推断】macOS 原生不支持 RNDIS：Mac 用户经 USB 连接时切到 RNDIS 并重启后，就无法再通过 USB 访问设备。新前端要醒目提示，并说明需要重启生效。

### 4.6 局域网 / DHCP

**读取**（打开「内网设置」时，`main.js:5113-5151`）：`cmd=lan_ipaddr,lan_netmask,mac_address,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour,mtu,tcp_mss`（没带 `multi_data`）。

| 字段 | 格式 | 原版用途 |
| --- | --- | --- |
| `lan_ipaddr` | `"192.168.0.1"` | 网关地址 |
| `lan_netmask` | `"255.255.255.0"` | 子网掩码 |
| `dhcpEnabled` | `"1"` / `"0"` | DHCP 开关 |
| `dhcpStart` / `dhcpEnd` | IPv4 | 地址池起止 |
| `dhcpLease_hour` | 【代码推断】`"24h"` | `.replace('h', '')` 后回填（字段缺失时抛异常 → toast「获取局域网设置失败」） |
| `mac_address`、`mtu`、`tcp_mss` | — | 请求了但不用 |

**表单**（`index.html:1035-1116`）：网关地址、子网掩码、「DHCP开关」（折叠开关，关闭时隐藏地址池和租期，`main.js:5294-5298` 同步隐藏字段 `lanDhcpType`）、地址池起始 / 结束、租期（小时，placeholder「租期(24)h」）。

**写入**（`onLANModalSubmit`，`main.js:5155-5292`）：

```
goformId=DHCP_SETTING&lanIp=<IP>&lanNetmask=<掩码>&lanDhcpType=<SERVER|DISABLE>
&dhcpStart=<IP 或空>&dhcpEnd=<IP 或空>&dhcpLease=<小时数 或空>&dhcp_reboot_flag=1&mac_ip_reset=<DHCP 开为 1，关为 0>
```

- DHCP 关闭时，地址池和租期提交空串（初始值），也不校验。
- `mac_ip_reset` 含义不明（【推断】清除 MAC-IP 绑定），照原版传。
- 校验顺序与提示：

| # | 规则 | 提示 |
| --- | --- | --- |
| 1 | 网关是合法 IPv4 | 请输入正确的网关地址 |
| 2 | 掩码在 `255.0.0.0`–`255.255.255.254` 的连续掩码列表里（`utils.js:570-580`） | 请输入正确的子网掩码 |
| 3 | DHCP 起始：合法 IPv4 / 与网关同网段 / 大于网关 | 请输入正确的起始地址 / 起始地址不在局域网IP所在网段内 / 起始地址应该比局域网IP地址大 |
| 4 | DHCP 结束：合法 IPv4 / 同网段 / 不等于起始 / 不小于起始 | 请输入正确的结束地址 / 结束地址不在局域网IP所在网段内 / 起始地址和结束地址不能相同 / 起始地址不能大于结束地址 |
| 5 | 租期 > 0 | 请输入正确的地址租期 |
| 6 | 网关不是网络地址或广播地址 | 网关地址不能是网络地址或广播地址 |
| 7 | 起始、结束不是网络地址或广播地址 | DHCP 起始地址不能是网络地址或广播地址 / DHCP 结束地址不能是… |
| 8 | 网关不在地址池范围内 | 网关地址不能落在 DHCP 分配范围内 |

- 结果：成功「设置成功! 设备正在重启~」，关闭弹窗，**30 s 后跳转到 `http://<新 lanIp>:2333`**（`main.js:5277-5283`）。失败时 `throw` 字符串，**没有任何提示**（同 §2.3）。
- 坑：
  1. `ipToInt` 用有符号 `<<`（`utils.js:582-584`），`128.0.0.0` 以上的地址会变成负数；同网段比较碰巧正确，新前端用 `>>> 0`。
  2. 跳转端口写死 2333，新前端用 `location.port`；改网段后客户端要重新拿 DHCP 地址，30 s 不一定够，应同时显示新地址让用户手动打开。
  3. 规则 3「起始必须大于网关」排除了「网关 .254、地址池 .2–.200」这类合法配置；规则 8 已经保证网关不在池内，规则 3 过严。
  4. 没有确认；这个操作会重启设备并改变访问地址，必须强确认。

### 4.7 流量套餐上限（补充《仪表盘文档》§7.3 / §7.4）

两套机制并存，在同一个「流量管理」弹窗的两个 Tab 里（`index.html:704-868`）。读取与回填见《仪表盘文档》§7.3、§7.4，这里补全提交细节。

#### 4.7.1 官方：`DATA_LIMIT_SETTING` + `FLOW_CALIBRATION_MANUAL`（`main.js:2226-2367`）

表单：启用流量管理？、流量清零？、套餐形式（只有「流量」一个单选）、清零日期（1–31）、提醒阈值（0–100 %）、流量套餐（数值 + MB / GB / TB）、已用流量（数值 + MB / GB / TB）。提示文案：「当流量到达设置的阈值百分比时机器会红灯闪烁提示您流量不足」。

**开关打开时**提交：

| 参数 | 值 |
| --- | --- |
| `data_volume_limit_switch`、`flux_data_volume_limit_switch` | `"1"` |
| `wan_auto_clear_flow_data_switch`、`flux_auto_clear_flow_data_switch` | 勾选为 `"on"`；**不勾选时前者保持默认 `"off"`、后者缺失**（未勾选的 checkbox 不进 FormData，代码里的 `'0'` 分支永远走不到） |
| `data_volume_limit_unit`、`flux_data_volume_limit_unit` | `"data"` |
| `traffic_clear_date`、`flux_clear_date` | 清零日 |
| `data_volume_alert_percent`、`flux_data_volume_alert_percent` | 0–100 |
| `data_volume_limit_size`、`flux_data_volume_limit_size` | `"<数值>_<倍数>"`，倍数 `1` = MB、`1024` = GB、`1048576` = TB |
| `flux_data_volume_limit_type` | `"_<倍数>"`（`data_volume_limit_type` 被删掉了，`flux_` 版本却保留） |
| `data_volume_used_size`、`data_volume_used_type` | 表单「已用流量」的数值和倍数 |
| `notify_deviceui_enable` | `"0"` |

**开关关闭时**只提交：`data_volume_limit_switch=0&wan_auto_clear_flow_data_switch=on&traffic_clear_date=1&notify_deviceui_enable=0&flux_data_volume_limit_switch=0&flux_auto_clear_flow_data_switch=on&flux_clear_date=1&flux_notify_deviceui_enable=0`。

随后**不论开关状态**都会发 `goformId=FLOW_CALIBRATION_MANUAL&calibration_way=data&time=0&data=<已用字节，整数>`（已用字节 = 数值 × 倍数 × 1024²）。两个请求都 success 才提示「设置成功」并关闭弹窗。

坑：

1. 开关关闭时仍要通过全部表单校验（套餐、已用都必须 > 0），并且仍会用表单里的「已用流量」去校准设备统计。
2. 「已用流量」必须 > 0（「已用流量必须大于0」），月初无法校准成 0。
3. 回填的已用流量是 `toFixed(2)` 后的 MB / GB / TB；用户没改也会原样提交，把设备统计「校准」成四舍五入后的值（GB 档最多差约 5 MB）。新前端：用户没改已用流量时不要发 `FLOW_CALIBRATION_MANUAL`。
4. 清零日校验写的是 0–31，提示却是 1–31。
5. 失败时 `throw` 的是字符串，`createToast(e.message)` 弹出「undefined」。

#### 4.7.2 UFI：`POST /api/set_data_limit`（`main.js:8261-8324`、`configModule.kt:219-281`）

表单：启用UFI流量管理？、统计方式（按日 / 按月）、流量参考（官方后台 / UFI后台）、断网流量（数值 + MB / GB / TB）、「断网时通知(需开启短信转发)？」。

请求体：

```json
{
  "data_flow_limit_enabled": "1",
  "data_flow_max_limit": "10737418240.000",
  "data_flow_check_daily_or_monthly": "monthly",
  "data_check_reference": "android",
  "data_limit_status_forward_enabled": "1"
}
```

- `data_flow_max_limit` = 数值 × 倍数 × 1024²，原版用 `toFixed(3)` 转成**字符串**；后端 `optLong` 能解析，≤ 0 归一为 `-1`（不限制）。新前端直接传 number。
- 流量参考：界面「官方后台」→ `default`，「UFI后台」→ `android`（后端把 `ufi` 也归为 `android`）。
- 坑：断网流量必须 > 0（「流量限制必须大于0！」），即使关闭开关也要满足，所以**无法保存「不限」**；回填时字节数 ≤ 0 显示 `0`，导致关闭状态下改别的选项也提交不了。失败同样弹出「undefined」。
- 「断网时通知」依赖短信转发总开关和已配置的渠道（§6.10）。
- 超限后后端会反复断网，手动打开数据也会被再次断开（§4.10）。

### 4.8 指示灯

- 按钮 `#LIGHT`「指示灯」（`index.html:103`），快捷开关模式（§1.3），`main.js:1603-1641`。
- 读：`cmd=indicator_light_switch`，`"1"` / `"0"`；写：`goformId=INDICATOR_LIGHT_SETTING&indicator_light_switch=<0|1>`。
- 异常时 toast `e.message`（其它快捷开关是静默）。

### 4.9 重启 / 关机 / 定时重启 / 恢复出厂

- 重启 `goformId=REBOOT_DEVICE`、关机 `goformId=SHUTDOWN_DEVICE`（都无参数）：确认方式与文案见《仪表盘文档》§8。关机按钮只在 `cmd=battery_value,battery_vol_percent` 两个值都非空时显示（`main.js:3060-3071`）。
- **每日定时重启**（`main.js:2976-3046`、弹窗 `index.html:1438-1464`）：
  - 读：`cmd=restart_schedule_switch,restart_time`（没带 `multi_data`）；`restart_schedule_switch == '1'` 时按钮高亮。
  - 弹窗：「启用每日定时重启？」勾选框；「每日重启时间：」**文本框**（placeholder `00:00`）。
  - 校验：正则 `/^(0?[0-9]|1[0-9]|2[0-3]):(0?[0-9]|[1-5][0-9])$/`，允许 `3:5` 这种不补零的写法；不匹配提示「请输入正确的重启时间 (00:00-23:59)」。关闭开关时也会校验时间。
  - 写：`goformId=RESTART_SCHEDULE_SETTING&restart_time=<时间>&restart_schedule_switch=<0|1>`；成功「设置成功」并关闭弹窗，失败「设置失败」。代码里还有「登录失败，请检查密码和网络连接」分支，但 `login()` 内部吞掉了所有异常，登录失败实际也显示「设置失败」。
  - 坑：`3:5` 会原样提交；【推断】固件期望 `HH:mm`，新前端用时间选择器并补零。
- **恢复出厂**：原版没有入口，`API_Doc.md` 的 goformId 表和后端源码都没有对应接口 → **不支持**；需要时引导用户去官方后台 `:8080`。

### 4.10 移动数据开关（摘要，详见《仪表盘文档》§2.3）

- 按钮 `#CECULLAR`「数据开关」（`index.html:101`），快捷开关模式（§1.3），`main.js:2761-2802`。
- 读：`cmd=ppp_status`；**只有** `"ppp_disconnected"` 算断开（按钮不高亮），其它任何值（含连接中等过渡态）都算已连接。
- 写：断开时发 `goformId=CONNECT_NETWORK`，否则发 `goformId=DISCONNECT_NETWORK`（都无参数）。点击后按钮文字变成「正在更改」；成功后**等 2 s** 再重读状态、toast「操作成功」并刷新 QCI；失败「操作失败」。
- 与 UFI 断网阈值冲突：阈值超限后，后端每 8 s 检查一次（`ADBService.kt:267-272`），只要还没断开，就先推送通知、3 s 后再发 `DISCONNECT_NETWORK`（`KanoUtils.kt:1187-1222`，其中 `isNetworkEnable()` 名字是反的，返回的是「已断开」，`:976-995`）。所以超限状态下手动打开数据，十秒左右会被再次断开，并且每次都会再推送一条通知。新前端在 `/api/baseDeviceInfo` 的 `is_reached_data_flow_limit` 为 true 时禁用开关或明确提示，引导用户先调高阈值（§4.7.2）。

---

## 5. 短信

### 5.1 列表读取：`cmd=sms_data_total`

请求（`getSmsInfo`，`requests.js:398-407`）：

```
GET /api/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=sms_data_total
    &page=0&data_per_page=500&mem_store=1&tags=100&order_by=order by id desc&_=<毫秒>
```

| 参数 | 原版值 | 说明 |
| --- | --- | --- |
| `page` | `0` | 页码从 0 开始；原版只取第 0 页 |
| `data_per_page` | `500` | 每页条数 |
| `mem_store` | `1` | 【推断】1 = 设备存储（NV），0 = SIM 卡；原版只读设备存储 |
| `tags` | `100` | 【推断】100 = 全部（收件 + 发件）；原版靠它同时拿到收件和发件 |
| `order_by` | `order by id desc` | 字面 SQL 片段，带空格（见 §1.4） |

- 直接用 `fetch`（不经 `getData`），**没有超时，不带会话头**；仍然带 UFI 鉴权头。【推断】需要官方后台登录态，新前端经 `goformGet()` 读取（`src/api/sms.ts` 已这样做）。
- 响应：`{"messages":[…]}`；没有 `messages` 时按空数组处理（`main.js:639`）。

单条字段（原版只用这 5 个，其余字段即使存在也不读）：

| 字段 | 示例 | 含义 | 出处 |
| --- | --- | --- | --- |
| `id` | `"58"` | 短信 ID，删除 / 已读 / 重发用 | `main.js:790`、`:807` |
| `number` | `"10086"` | 对方号码（收件为发件人，发件为收件人） | `main.js:807`、`:816` |
| `content` | `"5L2g5aW9"`（「你好」） | **UTF-8 文本的 Base64**，可能缺 `=` 补位【代码】【文档】 | `main.js:806`、`utils.js:185-199` |
| `tag` | `"0"`–`"4"` | 状态，见下表 | `main.js:790`、`:807-816` |
| `date` | `"25,10,29,14,03,22,+32"` | 逗号分隔的 7 段 | `main.js:781-804` |

`tag`：

| 值 | 原版处理【代码】 | 含义 |
| --- | --- | --- |
| `"1"` | 打开列表即批量标记已读；按「收到」样式显示 | 未读（收） |
| `"0"` | 按「收到」样式显示 | 【推断】已读（收） |
| `"2"` | 右侧粉色气泡 | 已发送 |
| `"3"` | 右侧粉色气泡 + 号码后红字「(发送失败)」+ 重发图标 | 发送失败 |
| `"4"` | 被当作「收到」显示（判断只看 `!= '2'`） | 【推断】草稿 |

`date`：`yy,MM,dd,HH,mm,ss,时区`。原版去掉最后一段，再按「年、月、空格、:、:」拼接，显示成 `25年10月29 14:03:22`（`main.js:781`、`:800-804`），**不做时区换算**。【推断】时区段以 15 分钟为单位（`+32` = UTC+8，3GPP TS 23.040），新前端 `sms.ts` 已按此解析。

排序：去掉时区后把各段拼成数字串，`Number()` 降序（`main.js:782-788`），依赖固件把每段补成两位【推断】。

### 5.2 弹窗与刷新

- 「短信收发」按钮 `#SMS`（`index.html:85`）→ `init()`（`main.js:1248-1262`）：未登录则弹登录框；否则立即 `handleSmsRender()`，之后**每 2 s 全量重拉 500 条**（`requestInterval`，基于 rAF，标签页在后台时暂停）。关闭弹窗或登出时停止（`utils.js:319-320`、`main.js:601-610`）。
- 弹窗布局（`index.html:542-565`）：标题「短信列表」；顶部「收件人：」号码输入框；中间气泡列表；底部内容输入框 +「发送」「关闭」。
- 气泡（`main.js:799-820`）：收到的在左（绿底），发出的在右（粉底）；每条右上角有删除图标；第一行号码，第二行内容，右下角时间。
- 按钮上的未读徽标来自主页轮询的 `sms_unread_num`（《仪表盘文档》§1.2 #4）。
- 渲染去重：只比较 **id 拼接串**（`main.js:777-780`）。
- 坑：
  1. **首次打开且没有短信时永远停在「Loading...」**：结果为空且 `isFirstRender` 为真时直接 return，`isFirstRender` 不会被置为 false（`main.js:768-775`），「暂无短信」永远不出现。首次请求失败也一样。
  2. 去重只看 id，**`tag` 变化（未读 → 已读、发送结果）不会重绘**。
  3. 每 2 s 拉 500 条，开销大。
  4. 内容先 `escapeHtml`，再赋给离屏元素的 `innerText`，再读回拼进 innerHTML（`main.js:805-817`）。【推断】离屏元素读回 `innerText` 时，setter 生成的 `<br>` 不会还原成换行，**多行短信的换行丢失、各行直接连在一起**。新前端用文本节点 + `white-space: pre-wrap`。
  5. `number` 没有转义就进了 HTML（字母数字发件人可能含特殊字符）。
  6. 读取失败的 `catch` 里引用了作用域外的 `res`（`main.js:634-643`），错误提示基本出不来。
- 新前端建议：按页读取（例如 50 条），页面可见时定时刷新，`sms_unread_num` 变化时立即刷新；按 `number` 分组成会话（`tag` 2 / 3 为发出）。

### 5.3 标记已读：`goformId=SET_MSG_READ`

- 每次渲染（id 串变化时）把所有 `tag == "1"` 的 id 交给 `readSmsByIds()`，不等待结果（`main.js:789-798`）。
- `readSmsByIds()`（`requests.js:369-395`）：`login()` 一次 → **逐条** `goformId=SET_MSG_READ&msg_id=<id>&notCallback=true`（每条都重新取 RD、算 AD）→ `logout()`。返回 `[{id, success, data}]`，调用方忽略。
- 坑：N 条未读约产生 3N + 5 个请求；界面上未读和已读没有任何样式区别，用户看不出哪些是新消息；结束时还会 LOGOUT（§1.1）。
- 新前端建议：列表读取保持只读（`smsApi.list` 已如此），用户打开某个会话时再把其中的未读逐条串行标记。【推断】中兴固件也许支持 `msg_id=1;2;3;` 这种批量格式，未证实前保持逐条。

### 5.4 发送：`goformId=SEND_SMS`

- 校验（`sendSMS`，`main.js:648-675`）：内容 `trim()` 后非空，并且 `Number(号码.trim())` 为真，否则「请输入手机号和内容」。发送中再点 →「请不要频繁发送！」。
- 请求（`sendSms_UFI`，`requests.js:342-353`）：`login()` → `goformId=SEND_SMS&Number=<号码>&MessageBody=<gsmEncode(内容)>` → `logout()`。原版只传这两个参数，没有 `ID`、`encode_type`、`sms_time` 之类【代码】。
- **`MessageBody` 编码**：`gsmEncode`（`requests.js:2`）名字有误导，**不是 GSM 7-bit**，而是 **UTF-16BE，每个 UTF-16 码元输出 4 位小写十六进制**：

| 内容 | `MessageBody` |
| --- | --- |
| `A` | `0041` |
| `你好` | `4f60597d` |
| `😀`（U+1F600） | `d83dde00`（代理对；函数里处理 >0xFFFF 的分支永远走不到，结果仍正确） |

  新前端可等价实现为：遍历 `str.charCodeAt(i)`，每个码元 `toString(16).padStart(4, '0')`。
- 结果：`result == 'success'` → 清空内容框（号码保留）、「短信发送成功」、刷新列表；否则显示 `res.message` 或「发送失败」；异常「发送失败，请检查网络和密码」。
- 长短信：原版不分段、不计数、不限长度，整段交给固件。【推断】固件自动拆成级联短信，UCS-2 每段 67 个字符。
- **没有发送状态轮询**：`success` 只表示固件接受了请求；失败要靠之后列表里出现 `tag == "3"` 的记录，而 §5.2 的去重又可能让界面不刷新。
- 坑：
  1. 号码框是 `<input type="number">`，输入不了 `+86…`、`*`、`#`；`Number()` 校验还会拒绝 `0` 这类号码。新前端用文本框，允许开头的 `+`，例如校验 `/^\+?\d{3,20}$/`【推断】。
  2. 内容框是单行 `input`，输入不了换行。
- 新前端建议：显示字数和条数（纯 GSM 字符 160 / 153 一条，含中文 70 / 67 一条【推断：通用规则】）；发送成功后 2–3 s 内重读列表，找到新的发出记录并更新为「已发送」或「失败」。

### 5.5 删除：`goformId=DELETE_SMS`

- 交互（`deleteSMS`，`main.js:678-730`）：点垃圾桶先显示红字「确定要删除吗？」（硬编码中文，没有 i18n），**2 s 内再点一次**才删除。
- 请求（`removeSmsById`，`requests.js:356-366`）：`login()` → `goformId=DELETE_SMS&msg_id=<id>&notCallback=true` → `logout()`。
- 结果：成功则移除该条 DOM、「删除成功」、300 ms 后重绘；失败显示 `res.message` 或「删除失败」；异常「操作失败，请检查网络和密码」。
- 没有批量删除、没有清空。
- 坑：请求在 2 s 内失败时，确认计时器会把 `isDeleting = true` 的旧状态写回 Map，**这一条之后再也点不动**，直到刷新页面。
- 新前端：Modal 确认；多选删除时逐条串行调用。【推断】多 ID 的 `msg_id` 格式未证实。

### 5.6 重发

- 只有 `tag == "3"` 的条目显示重发图标 → `deleteAndReSendSms(id)`（`main.js:732-750`）：**先删除原记录**（跳过确认），再从 DOM 的 `data-sms-phone` / `data-sms-content` 取号码和内容，填回输入框并调用 `sendSMS()`。
- 坑：先删后发，重发失败时原短信已经没了；删除失败时仍会继续发送。新前端先发送，成功后再删旧记录（或保留）。

### 5.7 原版没有的功能

批量删除、全部已读、按联系人分组、搜索、存储容量、SIM 卡短信、发送状态查询、导出——`API_Doc.md` 和后端都没有相关接口证据。批量操作只能用 `SET_MSG_READ` / `DELETE_SMS` 逐条组合。

---

## 6. 短信转发

### 6.1 工作机制【后端】

- 转发由 UFI 后端独立完成，**不读官方后台的短信**。`ADBService.kt:257-274` 每 **8 s** 检查一次；总开关 `kano_sms_forward_enabled == "1"` 时调用 `SmsPoll.checkNewSmsAndSend()`。
- `getLatestSms()`（`SmsPoll.kt:285-324`）只读 Android 收件箱 `content://sms/inbox` 的**最新一条**；`checkNewSmsAndSend()`（`SmsPoll.kt:28-86`）只转发**2 分钟内**、且与上次不同的那一条。后果：8 s 内到达多条只转最后一条；服务停止期间、或超过 2 分钟才检测到的短信不会补发。新前端在设置页写明这个限制。
- 黑名单（`SmsPoll.kt:42-66`）：号码按行 `trim` 后**精确匹配** `sms.address`；关键词按行 `trim` 后做**区分大小写的子串匹配**；命中则不转发。
- 渠道由 `kano_sms_forward_method` 决定（`SMTP` / `CURL` / `DINGTALK`），**最后一次保存的渠道生效**；三套配置各自保留、互不覆盖。
- 三个渠道都在单线程队列里**异步**发送，失败只写日志（`KanoSMTP.kt:38-102`、`KanoCURL.kt:15-31`、`KanoDingTalk.kt:28-76`）。所以保存接口返回 success 只表示「配置已保存、测试消息已入队」，不代表送达。

### 6.2 弹窗结构与加载顺序

- 「短信转发」按钮（`index.html:111`）→ 弹窗（`index.html:1888-2100`）：标题「短信转发(Beta)」+ 关闭；「总开关」开关；三个 Tab（SMTP方式 / CURL方式 / 钉钉方式）；**总开关打开时才展开**的折叠区，里面是「电源状态通知」开关、「转发规则」「设置别名」按钮，以及当前 Tab 的表单。
- 打开时（`main.js:4719-4745`）同时做两件事：
  1. `initSmsForward()`：`GET /api/sms_forward_method` → 按返回值读对应渠道配置，并切到对应 Tab；返回空串时切到 SMTP Tab。
  2. `initSmsForwardSwitch()`：`GET /api/sms_forward_enabled` → 同步折叠状态 → 显示弹窗 → `GET /api/power_status_forward_enabled` 同步电源通知开关。
- 切换 Tab（`main.js:4663-4691`、`:4891-4904`）：只切换表单并读取该渠道已保存的配置，**不改变生效渠道**。
- 坑：
  1. Tab 的初始高亮等于生效渠道，用户切换后就不再代表生效渠道，界面上看不出到底在用哪个。新前端单独显示「当前渠道」标记。
  2. `sms_forward_method` 缺失时 `.toLowerCase()` 抛异常。
  3. 总开关初值取 localStorage（`collapse_smsforward`），服务端状态返回前可能显示错误。
  4. 总开关关闭时配置表单被折叠隐藏，无法先配好再打开。

### 6.3 总开关

- 用户切换 → `POST /api/sms_forward_enabled?enable=1|0`（**query 参数**，没有 body；`main.js:4907-4925`），toast「短信转发 已启用 / 已禁用」，失败「操作失败」。
- 后端（`smsModule.kt:199-226`）：缺少 `enable` → 500 `{"error":"请求出错"}`；**不校验取值**，任何字符串都会存下，只有 `"1"` 生效。
- `GET /api/sms_forward_enabled` 返回 `{"enabled":"0"}` / `{"enabled":"1"}`（字符串）。
- 依赖总开关的功能：短信转发、电源状态通知（§6.8）、UFI 流量阈值断网通知（§6.10）。

### 6.4 渠道配置

#### SMTP（`main.js:4747-4804`；`smsModule.kt:41-133`）

| 界面 | 字段 | 前端校验与提示 | 后端 |
| --- | --- | --- | --- |
| 主机 | `smtp_host` | 必填：请输入SMTP服务器地址 | 必填 |
| 端口（number，placeholder 465） | `smtp_port` | 必填：请输入SMTP服务器端口 | 缺省 `"465"` |
| 用户 | `smtp_username` | 必填：请输入SMTP服务器用户名 | 必填 |
| 发件邮箱 | `smtp_from` | 可空；非空必须含 `@`：请输入合法的发件邮箱（需包含 @） | 同；为空时用 `smtp_username` |
| 发件人名 | `smtp_from_name` | 可空 | 可空 |
| 密码 | `smtp_password` | 必填：请输入SMTP服务器密码 | 必填 |
| 发给（`type=email`） | `smtp_to` | 必填：请输入收件人邮箱 | 必填 |
| 同时转发设备信息 | `forward_dev_info` | 勾选框 → `"1"` / `"0"` | — |

- 所有值 `trim()` 后以 JSON 提交。成功 toast「设置成功,系统会向目标邮箱发送一个测试消息，请注意查收~」，**不关闭弹窗**；失败显示 `res.error`（后端统一为 `"SMTP配置出错"`，不含具体原因）或「设置失败」；网络异常「请求失败」。
- 加密方式由端口决定：`465` / `2465` / `8465` / `443` / `588` 走隐式 SSL，其余端口走 STARTTLS，强制 TLSv1.2（`KanoSMTP.kt:32`、`:42-63`）；连接 / 读 / 写超时 10 / 15 / 15 s。
- 邮件：主题 = 短信内容前 37 个字符 + `…`；HTML 正文 = 内容、来自、时间、（可选）设备信息、Powered by（`SmsPoll.kt:165-216`）。短信内容**未做 HTML 转义**就插进了正文。
- `GET /api/sms_forward_mail` **明文返回密码**（用 JSONObject 序列化，特殊字符安全）：

```json
{"smtp_host":"smtp.qq.com","smtp_port":"465","smtp_to":"me@example.com","smtp_username":"123456@qq.com","smtp_password":"<授权码>","smtp_from":"","smtp_from_name":"","forward_dev_info":"1"}
```

#### CURL（`main.js:4806-4842`；`smsModule.kt:136-196`；`SmsPoll.kt:89-120`；`KanoCURL.kt`）

- 只有一个 textarea `curl_text`；前端只校验非空（「请输入curl请求！」）。后端要求同时包含 `{{sms-body}}`、`{{sms-time}}`、`{{sms-from}}`，缺一个就返回 500 `{"error":"curl配置出错：没有找到“{{sms-body}}”占位符"}`，原版直接把这个 error 显示出来。
- 成功 toast「设置成功,系统会向目标地址发送一个测试消息，请注意查收~」。
- `GET /api/sms_forward_curl` 返回 `{"curl_text":"<原样模板>"}`（JSONObject 序列化，安全）。

**执行过程**【后端】：

1. 先替换三个短信占位符（`SmsPoll.kt:101-111`），再替换设备占位符（`KanoUtils.kt:1045-1150`），最后 `trimIndent()`。
2. `command.replaceFirst("curl", "")` 去掉**第一个** `curl` 字样，再用正则 `(["'])(.*?)(?<!\\)\1|(\S+)` 切分参数（`KanoUtils.kt:51`、`:499-509`）：引号内的内容原样保留（反斜杠不去掉）；裸参数去掉所有 `\`。
3. 直接执行打包的 `assets/shell/curl` 并传入参数数组，10 s 超时（`KanoCURL.kt:15-31`）。**不经过 shell**：`$()`、`;`、`|` 不会被解释，没有命令注入；但也不支持管道、变量、换行续行（界面提示「命令需是“一口气”输入的，不要中途按回车换行或用 \ 接续」）。

**占位符与转义**：

| 占位符 | 替换为 | 转义 |
| --- | --- | --- |
| `{{sms-body}}` | 短信内容 `trim()` 后 | **JSON 字符串转义**：`JSONObject.quote(...)` 再去掉首尾引号，即 `"` → `\"`、`\` → `\\`、换行 → `\n`；【推断】Android 版 org.json 还会把 `/` 转成 `\/`。**不做 shell 转义，也不做 URL 编码** |
| `{{sms-time}}` | `yyyy-MM-dd HH:mm:ss`（设备时区） | 无 |
| `{{sms-from}}` | 号码原样 | 无 |
| `{{cpu-usage}}` | `"<数值>%"` | 无（以下同） |
| `{{mem-usage}}` | `"<数值>%"` | |
| `{{app-ver}}` | 版本名 | |
| `{{battery-level}}` | `"81%"` | |
| `{{battery-current}}` | `"<µA ÷ 1000，整数除法>mA"` | |
| `{{battery-voltage}}` | `"%.2fV"` | |
| `{{model}}` | 设备型号 | |
| `{{nickname}}` | 设备别名（§6.7） | |
| `{{boot-time}}` | `"%.2fh"`（开机小时数） | |
| `{{cpu-temp}}` | `"%.2f°C"` | |
| `{{daily-flow}}` | 当日流量（可读大小） | |
| `{{monthly-flow-count}}` | 本月流量（Android 统计） | |
| `{{monthly-flow-sum}}` | 本月流量（官方后台统计） | |

由此产生的坑（新前端在模板编辑处提示用户）：

1. 模板用单引号包 JSON（如 Telegram / 企业微信模板 `-d '{...}'`）时，**短信里出现 `'` 会提前结束引号**，参数被切碎、请求失败（JSON 转义不处理单引号）。
2. 模板用双引号包 form 表单（如 PushPlus `-d "token=…&content={{sms-body}}…"`）时：短信里的 `"` 被转成 `\"`，因引号内反斜杠不会去掉，对方收到的是 `\"`；`&`、`%`、`+` 没有 URL 编码，会破坏表单参数。
3. 设备占位符和 `{{sms-from}}` 完全不转义；别名里有 `"` 会破坏 JSON 模板。

**预设模板**（`utils.js:925-966`）：「Telegram」「企业微信」「PushPlus」「Bark」四个按钮，点击后把模板填进 textarea，并弹出教程浮层（`tg_sms_help` 等，内容是带 `<br>` 的 HTML）。模板里的 `<你的token>`、`<你的聊天会话id>` 等需要用户自己替换，原版不检查。

#### 钉钉（`main.js:4844-4888`；`smsModule.kt:378-444`；`KanoDingTalk.kt`）

- 字段：`webhook_url`（表单 name `dingtalk_webhook`，必填：「请输入钉钉Webhook地址」）、`secret`（表单 name `dingtalk_secret`，可空，即加签密钥）、`forward_dev_info`。
- 成功 toast「钉钉测试消息发送成功」——**措辞不准**，实际只是入队。
- 加签（`KanoDingTalk.kt:46-57`）：`HmacSHA256(secret, "<毫秒时间戳>\n<secret>")` → Base64 → URL 编码，拼成 `<webhook>&timestamp=<ts>&sign=<sign>`，所以 webhook 必须已带 `?access_token=`。
- 消息：`text` 类型；内容为「📱 新短信通知 / 📄 内容 / 📞 来自 / ⏰ 时间」，可选设备信息，结尾「Powered by UFI-TOOLS」（`SmsPoll.kt:220-276`）。
- `GET /api/sms_forward_dingtalk` 用**字符串模板**拼 JSON（`smsModule.kt:434-440`），webhook 或 secret 含 `"`、`\` 时返回非法 JSON：

```json
{"webhook_url":"https://oapi.dingtalk.com/robot/send?access_token=xxx","secret":"SECxxxx","forward_dev_info":"0"}
```

#### 测试消息

三个渠道保存成功后，后端都会立即用该渠道发一条测试消息：号码 `1145141919810`，内容 `UFI-TOOLS TEST消息`（`smsModule.kt:86-87`、`:159-161`、`:404-406`）。原版没有独立的「测试发送」按钮（可用 §6.9 实现）。

#### `GET /api/sms_forward_method`

`{"sms_forward_method":"SMTP"}`，取值 `SMTP` / `CURL` / `DINGTALK` / `""`（从未保存过）（`smsModule.kt:26-38`）。

### 6.5 附带设备信息（`forward_dev_info`）

- SMTP 和钉钉各存一份（`kano_smtp_forward_device_info`、`kano_dingtalk_forward_device_info`）；CURL 没有这个开关，改用设备占位符。
- 内容：当日用量、月用量（两种统计）、CPU 温度、CPU / 内存占用、电池（电量 电流 电压）、开机时长、设备名称 `model(nickname)`、APP 版本（`SmsPoll.kt:172-187`、`:241-255`）。

### 6.6 转发规则（黑名单）

- 「转发规则」按钮 → 浮层（`main.js:5017-5094`）：「号码黑名单」「关键字黑名单」两个 textarea（placeholder 说明换行分隔、留空不拦截），「提交 / 取消」。
- 读：`GET /api/sms_forward_blacklist` → `{"keywords":"…","phone":"…"}`，两个都是换行分隔的字符串（JSONObject 序列化）。
- 写：`POST /api/sms_forward_blacklist`，body `{"keywords":"…","phone":"…"}`。前端校验 `phone` 匹配 `/^[0-9\n]*$/`，否则「手机号列表只允许包含数字！」；后端同样校验，并要求两个键都存在，否则 500 `{"error":"请求出错"}`（`smsModule.kt:307-345`）。成功「保存成功」，失败「保存失败」，两种情况都会关闭浮层。
- 坑：
  1. 号码只允许数字，而 Android 收件箱的 `address` 常带 `+86` 前缀【推断】，精确匹配会失效；后端又拒绝 `+`。新前端只能提示「号码需与收到短信时显示的号码一致（不含 +）」。
  2. 关键词区分大小写。
  3. 前端只做 `trim().split('\n').join('\n')`，不去空行、不去行内空格（后端匹配时会逐行 trim）。

### 6.7 设备别名（`nickname`）

- 入口：转发弹窗的「设置别名」；另有隐藏入口——页面标题旁的型号文字 `#MODEL`（`index.html:53-55`）2 s 内连点 2 次（`nicknameSettingClick`，`main.js:4930-4941`）。
- 读：`GET /api/version_info`（免鉴权）的 `nickname`（默认 `Build.MODEL`），输入框 placeholder 为 `model`。
- 写：`POST /api/set_nickname`，body `{"nickname":"…"}`；前端 `maxlength=255`，后端截断到 255（`baseDeviceInfoModule.kt:300-322`）。成功「保存成功」并刷新页面标题（`loadTitle()`），失败「保存失败」。
- 用途：转发消息和电源通知里的设备名、`{{nickname}}`、页面标题。
- 坑：`/api/version_info` 用字符串模板拼 JSON（`baseDeviceInfoModule.kt:325-340`），别名含 `"` 或 `\` 会让这个免鉴权接口返回非法 JSON（登录页、标题都会受影响）。新前端禁止输入这两个字符。

### 6.8 电源状态通知

- 折叠区开关（`main.js:4693-4716`）：`POST /api/power_status_forward_enabled?enable=1|0`，toast「电源状态通知功能 已启用 / 已禁用」；`GET` 返回 `{"enabled":"0"|"1"}`（`smsModule.kt:253-304`）。
- 生效条件：本开关和短信转发总开关都为 `"1"`（`ADBService.kt:221-230`）。
- 触发事件（`ADBService.kt:179-212`、`BatteryReceiver.kt:9-12`）：电量低（10%）、电量过低（5%）、充满、插入电源。消息中英双语，标题如「<别名> 电量低（10%）」。
- 走当前渠道发送，标题放在「号码」位置（`SmsInfo(title, message, now)`），所以 CURL 模板里的 `{{sms-from}}` 会是标题。

### 6.9 `POST /api/do_forward_msg`（原版界面没用）

- body：`{"address":"…","body":"…","is_sms":true,"timestamp":<毫秒>}`；`is_sms` 缺省 `true`，`timestamp` 缺省为当前时间。按当前渠道推送（`smsModule.kt:447-493`）。`is_sms=false` 时 SMTP / 钉钉只发设备信息（CURL 不区分）。
- **不检查总开关和黑名单**（直接调用转发函数）。没有配置渠道时什么也不做，但仍返回 success。
- 新前端可以用它做「发送测试消息」按钮（不必重新保存配置），例如 `{"address":"AirPulse","body":"这是一条测试消息"}`。

### 6.10 与 UFI 流量阈值的联动

「流量管理」UFI Tab 的「断网时通知(需开启短信转发)？」（`data_limit_status_forward_enabled`）：达到阈值、断网前，如果它为 `"1"` 且转发总开关打开，会经当前渠道推送「流量达到设定值：(…)，即将断网！」（`KanoUtils.kt:1175-1184`、`:1210`）。

---

## 7. 危险操作与确认建议

原版本范围内几乎所有操作都没有确认。按 `CLAUDE.md` 改用 Modal 时，建议如下：

| 操作 | 原版 | 后果 | 新前端建议 |
| --- | --- | --- | --- |
| 关闭 Wi-Fi / 切换 2.4G·5G | 选中即提交 | Wi-Fi 接入者断线；关闭后只能走 USB | 判断当前是否经 Wi-Fi 接入，是则强确认 |
| 改 SSID / 密码 / 加密 / 隐藏 SSID | 无确认 | 所有 Wi-Fi 客户端断线、需重连 | 确认框列出新旧值 |
| 拉黑设备 | 无确认 | 被拉黑设备断开；拉黑本机即失联 | 确认；对「本机」二次警告 |
| 修改局域网 / DHCP | 无确认 | 设备重启、管理地址改变 | 强确认，显示新地址 |
| USB 网络模式 | 选中即提交 | 重启后生效；macOS 不支持 RNDIS | 确认并给出平台提示 |
| 切换 SIM 卡槽 | 选中即提交 | 断网并重新注册 | 确认 |
| 切换 / 删除 APN | 无确认 | 断网；原版可能删错配置（§4.1.7） | 确认，显示配置名 |
| 开启数据漫游 | 无确认 | 可能产生漫游费用 | 确认 |
| 删除短信 | 2 s 内连点两次 | 不可恢复 | Modal 确认 |
| 重发失败短信 | 先删后发 | 发送失败则原文丢失 | 先发后删 |
| 每日定时重启 | 无确认 | 每天定时断网 | 保存时说明影响 |
| 重启、关机 | 连点确认 | — | 见《仪表盘文档》§8 |

---

## 附录 A：Mock 示例 JSON

说明：

- goform 读接口的响应键一般与 cmd 同名；**例外**是几个复合 cmd：`queryWiFiModuleSwitch,queryAccessPointInfo` → `WiFiModuleSwitch` + `ResponseList`；`queryDeviceAccessControlList` → `AclMode` / `BlackMacList` / `BlackNameList` / `WhiteMacList` / `WhiteNameList`；`hostNameList` → `devices`；`sms_data_total` → `messages`。
- 值一般是字符串。表里未列出的 cmd 返回 `""`（与现有 `mock/device.ts` 的默认行为一致）。
- 原版读取的键已在正文标注；标【推断】的键是为了贴近真机补充的，原版不读。

### A.1 `cmd=queryWiFiModuleSwitch,queryAccessPointInfo`（5G 开启）

`EncrypType`、`ApIsolate` 是否出现在读响应里【推断】；`QrImageUrl` 只是占位值，真机格式未知（新前端不依赖它）。

```json
{
  "WiFiModuleSwitch": "1",
  "ResponseList": [
    {
      "AccessPointIndex": "0",
      "ChipIndex": "0",
      "AccessPointSwitchStatus": "0",
      "SSID": "ZTE-F50-2.4G",
      "AuthMode": "WPA2PSK",
      "EncrypType": "CCMP",
      "Password": "QWlyUHVsc2VAMjAyNg==",
      "ApMaxStationNumber": "10",
      "ApBroadcastDisabled": "0",
      "ApIsolate": "0",
      "QrImageUrl": "/img/qrcode_ssid_wifikey.png"
    },
    {
      "AccessPointIndex": "0",
      "ChipIndex": "1",
      "AccessPointSwitchStatus": "1",
      "SSID": "ZTE-F50-5G",
      "AuthMode": "WPA2PSKWPA3PSK",
      "EncrypType": "CCMP",
      "Password": "QWlyUHVsc2VAMjAyNg==",
      "ApMaxStationNumber": "16",
      "ApBroadcastDisabled": "0",
      "ApIsolate": "0",
      "QrImageUrl": "/img/qrcode_ssid_wifikey.png"
    }
  ]
}
```

`Password` 解码后为 `AirPulse@2026`。变体：

- Wi-Fi 关闭：`WiFiModuleSwitch` 改为 `"0"`，所有 `AccessPointSwitchStatus` 改为 `"0"`。
- 2.4G 开放网络：第一项 `AccessPointSwitchStatus: "1"`、`AuthMode: "OPEN"`、`EncrypType: "NONE"`、`Password: ""`，第二项 `AccessPointSwitchStatus: "0"`。
- 隐藏 SSID：`ApBroadcastDisabled: "1"`。

写入后的状态变化（给 mock 的 `write()` 用）：`switchWiFiModule` + `SwitchOption=0` → 关闭；`switchWiFiChip` + `ChipEnum=chip1|chip2` → `WiFiModuleSwitch="1"`，`chip1` 对应 `ChipIndex: "0"`、`chip2` 对应 `ChipIndex: "1"`，该项 `AccessPointSwitchStatus` 置 `"1"`、另一项置 `"0"`；`setAccessPointInfo` → 按请求里的 `ChipIndex` 覆盖该项字段（`Password` 原样存 Base64；`OPEN` 时请求不带 `Password`，存为 `""`）。

### A.2 简单状态字段（cmd 名 = 响应键）

```json
{
  "sleep_sysIdleTimeToSleep": "-1",
  "is_support_nfc_functions": "1",
  "web_wifi_nfc_switch": "0",
  "performance_mode": "0",
  "indicator_light_switch": "1",
  "roam_setting_option": "off",
  "dial_roam_setting_option": "off",
  "usb_network_protocal": "0",
  "sim_slot": "0",
  "dual_sim_support": "0",
  "restart_schedule_switch": "1",
  "restart_time": "04:00",
  "battery_value": "76",
  "battery_vol_percent": "76",
  "modem_main_state": "modem_init_complete",
  "mc_modem_main_state": "",
  "pinnumber": "3",
  "sim_pinnumber": "",
  "puknumber": "10"
}
```

- `modem_main_state` 的正常值 `modem_init_complete` 为【推断】；原版代码只出现过 `modem_waitpin` / `modem_waitpuk`。
- 变体：休眠不支持 `{"sleep_sysIdleTimeToSleep": ""}`；无 NFC `{"is_support_nfc_functions": "0"}`；无电池（关机按钮隐藏）`{"battery_value": "", "battery_vol_percent": ""}`；SIM 需要 PIN `{"modem_main_state": "modem_waitpin", "pinnumber": "2"}`；需要 PUK `{"modem_main_state": "modem_waitpuk", "pinnumber": "0"}`；V50 外置卡 `{"sim_slot": "11", "dual_sim_support": "1"}`（同时把 `/api/version_info` 的 `model` 改为 `"V50"`）。

### A.3 `cmd=station_list,lan_station_list,queryDeviceAccessControlList,hostNameList`

`192.168.0.253` 与《仪表盘文档》附录 C.3 里 `/api/baseDeviceInfo` 的 `client_ip` 相同，可用来演示「本机」标记；第三台设备 `hostname` 为空，用来演示无名设备。

```json
{
  "station_list": [
    { "hostname": "iPhone", "ip_addr": "192.168.0.101", "mac_addr": "a4:83:e7:12:34:56" },
    { "hostname": "MacBook-Air", "ip_addr": "192.168.0.102", "mac_addr": "3c:22:fb:ab:cd:ef" },
    { "hostname": "", "ip_addr": "192.168.0.103", "mac_addr": "9a:1b:2c:3d:4e:5f" }
  ],
  "lan_station_list": [
    { "hostname": "kittors-mbp", "ip_addr": "192.168.0.253", "mac_addr": "02:50:f4:00:00:01" }
  ],
  "AclMode": "2",
  "WhiteMacList": "",
  "WhiteNameList": "",
  "BlackMacList": "de:ad:be:ef:00:01",
  "BlackNameList": "Unknown-TV",
  "devices": [
    { "mac": "3c:22:fb:ab:cd:ef", "hostname": "工作本" }
  ]
}
```

- `AclMode` 的值和 `WhiteMacList` / `WhiteNameList` 两个键为【推断】。
- 没有设备时，列表可能是 `[]` 也可能是 `""`，两种都要兼容；黑名单为空时 `BlackMacList` / `BlackNameList` 为 `""`。
- 写入：`EDIT_HOSTNAME` → 在 `devices` 里新增或更新 `{mac, hostname}`；`setDeviceAccessControlList` → 用请求里的四个串覆盖，被拉黑的 MAC 从 `station_list` / `lan_station_list` 移除。

### A.4 `getAPNData()`（手动模式）

未列出的 APN 字段（`APN_config3`–`19`、`ipv6_APN_config3`–`19` 等）一律为 `""`。`APN_config` 下标 2、3、8 以后的内容是【推断】格式（§4.1.2）。

```json
{
  "apn_interface_version": "2",
  "apn_mode": "manual",
  "apn_num_preset": "1",
  "apn_Current_index": "1",
  "index": "1",
  "APN_config0": "中国移动($)cmnet($)auto($)*99#($)none($)($)($)IPv4v6($)auto($)($)auto($)($)($)",
  "APN_config1": "物联网卡($)cmiot($)manual($)*99#($)none($)($)($)IP($)auto($)($)auto($)($)($)",
  "APN_config2": "专网($)vpdn.example($)manual($)*99#($)chap($)user01($)pass01($)IPv4v6($)auto($)($)auto($)($)($)",
  "ipv6_APN_config0": "中国移动($)cmnet($)auto($)*99#($)none($)($)($)IPv4v6($)auto($)($)auto($)($)($)",
  "ipv6_APN_config1": "",
  "ipv6_APN_config2": "专网($)vpdn.example($)manual($)*99#($)chap($)user01($)pass01($)IPv4v6($)auto($)($)auto($)($)($)",
  "profile_name": "物联网卡",
  "apn_m_profile_name": "物联网卡",
  "profile_name_ui": "物联网卡",
  "apn_wan_apn": "cmiot",
  "apn_ipv6_wan_apn": "",
  "apn_pdp_type": "IP",
  "apn_ppp_auth_mode": "none",
  "apn_ppp_username": "",
  "apn_ppp_passwd": "",
  "ppp_auth_mode_ui": "none",
  "ppp_username_ui": "",
  "ppp_passwd_ui": "",
  "wan_apn_ui": "cmiot",
  "pdp_type_ui": "IP",
  "apn_wan_dial": "*99#",
  "apn_select": "manual",
  "dns_mode": "auto"
}
```

变体：

- 自动模式：`{"apn_mode": "auto", "profile_name": "中国移动", "apn_m_profile_name": "中国移动", "profile_name_ui": "中国移动", "apn_wan_apn": "cmnet", "apn_pdp_type": "IPv4v6", "apn_Current_index": "0"}`。
- 空槽（复现 §4.1.7 的错位 bug）：`{"APN_config1": "", "ipv6_APN_config1": ""}`，保留 `APN_config2`。原版下拉只有「中国移动」「专网」两项，选「专网」时 `selectedIndex = 1`，真实槽位却是 2。

写入：`apn_action=save` → 写 `APN_config<index>`；`delete` → 清空该槽；`set_default` → 改 `apn_mode=manual` 和当前配置相关字段；`apn_mode=auto` → 改回自动。

### A.5 `cmd=lan_ipaddr,lan_netmask,mac_address,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour,mtu,tcp_mss`

`dhcpLease_hour` 的 `h` 后缀来自原版的 `.replace('h', '')`【代码推断】；`mtu`、`tcp_mss` 的值为【推断】。

```json
{
  "lan_ipaddr": "192.168.0.1",
  "lan_netmask": "255.255.255.0",
  "mac_address": "34:5a:b4:12:34:56",
  "dhcpEnabled": "1",
  "dhcpStart": "192.168.0.100",
  "dhcpEnd": "192.168.0.200",
  "dhcpLease_hour": "24h",
  "mtu": "1500",
  "tcp_mss": "1460"
}
```

### A.6 `cmd=sms_data_total&page=0&data_per_page=…&mem_store=1&tags=100&order_by=order by id desc`

覆盖 4 种 `tag`；id 57 的内容带换行（用来验证 §5.2 坑 4）。日期为 UTC+8。

```json
{
  "messages": [
    {
      "id": "58",
      "number": "10086",
      "content": "44CQ5Lit5Zu956e75Yqo44CR5oKo55qE6aqM6K+B56CB5Li6IDQ4MjkxNu+8jDUg5YiG6ZKf5YaF5pyJ5pWI44CC5aaC6Z2e5pys5Lq65pON5L2c77yM6K+35b+955Wl5pys55+t5L+h44CC",
      "tag": "1",
      "date": "25,10,29,14,03,22,+32"
    },
    {
      "id": "57",
      "number": "10086",
      "content": "5bCK5pWs55qE5a6i5oi377yM5oiq6Iez5LuK5pelIDA4OjAw77yM5oKo5pys5pyI5aWX6aSQ5YaF6YCa55So5rWB6YeP5bey5L2/55SoIDYwLjVHQu+8jOWJqeS9mSAxMzkuNUdC44CCCuWbnuWkjSBDWExMIOafpeivouivpuaDheOAgg==",
      "tag": "0",
      "date": "25,10,29,09,12,05,+32"
    },
    {
      "id": "56",
      "number": "13800138000",
      "content": "5aW955qE77yM5pma5LiK6KeB",
      "tag": "2",
      "date": "25,10,28,21,40,11,+32"
    },
    {
      "id": "55",
      "number": "13800138000",
      "content": "5LuK5pmaIDgg54K55byA5Lya77yM5Yir6L+f5Yiw",
      "tag": "3",
      "date": "25,10,28,21,39,50,+32"
    }
  ]
}
```

解码：58「【中国移动】您的验证码为 482916，5 分钟内有效。如非本人操作，请忽略本短信。」；57「尊敬的客户，截至今日 08:00，您本月套餐内通用流量已使用 60.5GB，剩余 139.5GB。⏎回复 CXLL 查询详情。」；56「好的，晚上见」；55「今晚 8 点开会，别迟到」。

- 没有短信时：`{"messages": []}`（真机是否会返回 `""` 未知，两种都要兼容）。
- 写入：`SET_MSG_READ` → 该条 `tag` 由 `"1"` 改为 `"0"`；`DELETE_SMS` → 删除该条；`SEND_SMS` → 解码 `MessageBody`（UTF-16BE 十六进制，例如 `597d7684ff0c665a4e0a89c1` = 「好的，晚上见」）后插入一条 `tag: "2"` 的新记录，id 递增。

### A.7 `GET /api/version_info`（免鉴权）

```json
{ "app_ver": "4.1.3", "app_ver_code": "20260908", "model": "F50", "nickname": "我的随身WiFi", "accept_terms": true }
```

`accept_terms` 是 JSON 布尔值；V50 机型把 `model` 改成 `"V50"`（SIM 卡槽下拉按它切换）。

### A.8 短信转发相关 GET 接口（以路径为键）

```json
{
  "/api/sms_forward_method": { "sms_forward_method": "CURL" },
  "/api/sms_forward_enabled": { "enabled": "1" },
  "/api/power_status_forward_enabled": { "enabled": "0" },
  "/api/sms_forward_mail": {
    "smtp_host": "smtp.qq.com",
    "smtp_port": "465",
    "smtp_to": "me@example.com",
    "smtp_username": "123456@qq.com",
    "smtp_password": "abcdefghijklmnop",
    "smtp_from": "",
    "smtp_from_name": "AirPulse",
    "forward_dev_info": "1"
  },
  "/api/sms_forward_curl": {
    "curl_text": "curl -X \"POST\" \"https://api.day.app/<你的token>/\" -H 'Content-Type: application/json; charset=utf-8' -d '{\"body\": \"【短信内容】{{sms-body}}\\n【时间】{{sms-time}}\", \"title\":\"{{sms-from}}\", \"group\": \"UFI-TOOLS_SMS\", \"isArchive\":1}'"
  },
  "/api/sms_forward_dingtalk": { "webhook_url": "", "secret": "", "forward_dev_info": "0" },
  "/api/sms_forward_blacklist": { "keywords": "退订\n广告", "phone": "10010\n95588" }
}
```

- 从未配置过时：`sms_forward_method` 为 `""`，`sms_forward_mail` 各项为 `""`（`forward_dev_info` 为 `"0"`），`curl_text` 为 `""`，钉钉三项为 `""` / `""` / `"0"`，黑名单两项为 `""`，两个开关为 `"0"`。
- `curl_text` 就是 `utils.js:943` 的 Bark 预设模板（模板里的 `\n` 是反斜杠加 n 两个字符）。
- 写入：`POST /api/sms_forward_{mail,curl,dingtalk}` 保存配置并把 `sms_forward_method` 改为 `SMTP` / `CURL` / `DINGTALK`；`POST /api/sms_forward_enabled?enable=` 与 `POST /api/power_status_forward_enabled?enable=` 直接存 query 里的值。

### A.9 写操作通用响应

goform（`POST /api/goform/goform_set_cmd_process`）：

```json
{
  "success": { "result": "success" },
  "failure": { "result": "failure" },
  "login_wrong_password": { "result": "3" }
}
```

- 原版只判断 `result == 'success'`，失败时的具体值没有证据，`"failure"` 是现有 mock 的约定【推断】。
- `SEND_SMS` / `DELETE_SMS` 失败时原版会优先显示 `res.message`，【推断】固件失败响应可能带 `message`。

UFI 自身接口：成功一律 HTTP 200 `{"result":"success"}`；失败为 HTTP 500：

| 接口 | 失败响应 | 出处 |
| --- | --- | --- |
| `POST /api/sms_forward_mail` | `{"error":"SMTP配置出错"}`（缺必填项、`smtp_from` 不含 `@` 等，统一这一句） | `smsModule.kt:96-104` |
| `POST /api/sms_forward_curl` | `{"error":"curl配置出错：没有找到“{{sms-body}}”占位符"}`（或 `{{sms-time}}`、`{{sms-from}}`） | `smsModule.kt:146-148`、`:171-179` |
| `POST /api/sms_forward_dingtalk` | `{"error":"钉钉配置出错：缺少必要参数：webhook_url"}` | `smsModule.kt:387-389`、`:414-422` |
| `POST /api/sms_forward_enabled`、`POST /api/power_status_forward_enabled` | `{"error":"请求出错"}`（缺少 `enable`） | `smsModule.kt:217-225`、`:271-279` |
| `POST /api/sms_forward_blacklist` | `{"error":"请求出错"}`（缺键或 `phone` 含非数字） | `smsModule.kt:336-344` |
| `POST /api/set_nickname` | `{"error":"设置昵称出错"}` | `baseDeviceInfoModule.kt:313-321` |
| `POST /api/do_forward_msg` | `{"error":"主动触发短信转发出错：<异常信息>"}` | `smsModule.kt:484-492` |
| `POST /api/set_data_limit` | `{"error":"<异常信息>"}` | `configModule.kt:272-280` |

鉴权失败统一是 HTTP 401、空响应体（`API_Doc.md` §1.5）。

---

## 附录 B：原版坑速查（新前端不要照搬）

1. 写请求实际不带会话头（`fetchWithTimeout` 覆盖请求头），短信操作后还会 LOGOUT（§1.1）。
2. 快捷开关用初始化时的旧值取反（§1.3）。
3. Wi-Fi 切换超时后下拉永久禁用、没有提示（§2.2）。
4. Wi-Fi 密码长度校验对 Base64 结果做，最大接入校验永远不触发，`ApIsolate` 每次被重置为 0，保存失败没有提示（§2.3）。
5. 二维码走 `/api` + `QrImageUrl`，后端很可能没有对应路由（§2.4）。
6. 解封时把 MAC 列表写进 `BlackNameList`；拉黑会清空白名单；`BlackNameList` 为空时黑名单区不显示（§3.4）。
7. 客户端名称未转义进 innerHTML（§3.2）。
8. APN 用下拉序号当槽位 `index`，有空槽时会改错 / 删错（§4.1.7）。
9. 漫游开关固定提交 `ConnectionMode=auto_dial`（§4.2）。
10. SIM 下拉对单卡机型也显示，未知 `sim_slot` 值显示成第一项（§4.3）。
11. DHCP 保存失败没有提示，跳转端口写死 2333（§4.6）。
12. 流量设置：关闭开关时仍校验并校准已用流量；已用流量不能为 0；UFI 阈值无法保存「不限」；失败 toast「undefined」（§4.7）。
13. 定时重启时间允许 `3:5` 这类不补零写法（§4.9）。
14. 短信列表：空列表永远「Loading...」；`tag` 变化不重绘；每 2 s 拉 500 条；多行内容丢换行（§5.2）。
15. 打开列表即逐条标记全部未读，界面又不区分未读（§5.3）。
16. 号码输入框是 `type=number`，不能输 `+`；内容框不能换行（§5.4）。
17. 删除请求在 2 s 内失败后，该条再也无法删除（§5.5）。
18. 重发是先删后发（§5.6）。
19. 转发 Tab 高亮不代表生效渠道；钉钉提示「测试消息发送成功」其实只是入队（§6.2、§6.4）。
20. curl 的 `{{sms-body}}` 只做 JSON 转义：单引号会切碎参数，form 模板里 `&` / `%` / `+` 不会被编码（§6.4）。
21. 号码黑名单只能填纯数字，匹配不到带 `+86` 的号码（§6.6）。
22. 别名或钉钉配置里的 `"`、`\` 会让 `/api/version_info`、`/api/sms_forward_dingtalk` 返回非法 JSON（§6.4、§6.7）。
23. UFI 断网阈值超限后，手动打开数据十秒左右会被后端再次断开并重复推送通知（§4.10）。
