# 原版 UFI-TOOLS「实时仪表盘」与「射频 / 锁频」数据参考

> 用途：AirPulse 用 React 重写前端时，照此制作 Mock 数据与 TypeScript 类型。
> 依据：只读分析原版前端快照 `app/frontEnd/legacy-public/`（UFI-TOOLS v4.1.3）、Android 后端 Kotlin 源码、`User_Doc.md` 内嵌的原版真机截图。**未连接设备、未抓包、未运行任何构建**。

## 阅读约定

**出处缩写**（行号以当前仓库文件为准）

| 缩写 | 实际路径 |
| --- | --- |
| `main.js` / `requests.js` / `utils.js` / `charts.js` / `i18n.js` | `app/frontEnd/legacy-public/script/*.js` |
| `index.html` / `zh.json` | `app/frontEnd/legacy-public/index.html`、`app/frontEnd/legacy-public/lang/zh.json` |
| `baseDeviceInfoModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/deviceInfo/baseDeviceInfoModule.kt` |
| `DeviceInfo.kt` | `app/src/main/java/com/minikano/f50_sms/utils/DeviceInfo.kt` |
| `atModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/at/atModule.kt` |
| `reverseProxyModule.kt` | `app/src/main/java/com/minikano/f50_sms/modules/reverseProxyModule.kt` |
| 截图A–H | `User_Doc.md` 内嵌截图，均为原版前端跑在 **U30 Air 真机（中国联通 4G LTE 驻留）** 上的画面，见下表 |

| 截图 | 小节 / 位置 | 文件 |
| --- | --- | --- |
| A | §4.4 基本状态区（`User_Doc.md:576`） | `User_Doc.assets/image-20260327013642201.png` |
| B | §4.3 设备监控区（`:544`） | `image-20260327013603495.png` |
| C | §6.3 流量统计（`:857`） | `image-20260327015116119.png` |
| D | §6.6 内存信息弹窗（`:942`） | `image-20260327015250740.png` |
| E | §6.6 温度信息弹窗（`:944`） | `image-20260327015324428.png` |
| F | §7.2 网络模式下拉（`:1016`） | `image-20260327015426602.png` |
| G | §7.3 锁定频段（`:1051`） | `image-20260327015445809.png` |
| H | §7.4 锁定基站（`:1094`） | `image-20260327015501175.png` |

**可信度标签**：**【代码】** 前端代码直接可证；**【后端】** Kotlin 源码可证；**【截图】** 真机截图可证；**【推断】** 未经证实，需真机抓包确认。

**接口约定**：goform 读接口统一为 `GET /api/goform/goform_get_cmd_process?isTest=false&cmd=<逗号分隔>&multi_data=1&_=<毫秒时间戳>`；写接口统一为 `POST /api/goform/goform_set_cmd_process`（`application/x-www-form-urlencoded`，需 `AD` 签名，见 `API_Doc.md` §3.13）。下文只写 `cmd=` 或 `goformId=`。

---

## 0. 速览：数据块、接口与刷新方式

| 数据块 | 接口 / cmd | 触发与频率 | 出处 |
| --- | --- | --- | --- |
| 主页状态（39 个 cmd 字段 + 展开的信号字段） | goform `cmd=<39 个>`、`multi_data=1`，带 `kano-cookie` 头 | 页面加载立即 1 次，之后每 `REFRESH_TIME`（默认 1000 ms） | `requests.js:409-458`、`main.js:1104-1105` |
| 硬件信息（CPU / 内存 / 温度 / 电池 / 存储 / Android 流量） | `GET /api/baseDeviceInfo` | 与主页状态同一轮，goform 返回后**串行**请求 | `requests.js:430-434` |
| QCI 与签约速率 | `GET /api/AT?command=AT+CGEQOSRDP=1&slot=<n>` | 加载 1 次 + 每 10 s；切网 / 切卡 / 数据开关后额外触发 | `main.js:3244-3304` |
| 选网模式 | `cmd=net_select` | 加载与登录后 1 次，切换后 1 次 | `main.js:1318-1378` |
| 频段锁 | `cmd=lte_band_lock,nr_band_lock` + `GET /api/getSupportNrBandList?slot=` | 加载与登录后 1 次，提交后 1 次 | `main.js:1671-1729` |
| 邻区 / 已锁小区 | `cmd=neighbor_cell_info,locked_cell_info` | 「锁定基站」区块展开时每 `REFRESH_TIME + 1500` ms | `main.js:1839-1906`、`main.js:4193-4203` |
| 官方流量限额 | `cmd=flux_data_volume_limit_switch,…`（`getDataUsage`） | 打开「流量管理」弹窗时 1 次 | `requests.js:512-522`、`main.js:2151-2223` |
| UFI 自身流量阈值 | `GET /api/get_data_limit` | 打开「流量管理」弹窗时 1 次 | `main.js:8201-8258` |

---

## 1. 主页状态轮询

### 1.1 请求与合并流程【代码】

1. `getUFIData()`（`requests.js:409`）
   - goform：`GET /api/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=<39 字段>&_=<ts>`，请求头带 `kano-cookie: KANO_COOKIE`（`requests.js:419-425`）；5 s 超时（`requests.js:410-411`）。cmd 原样拼接，逗号未 URL 编码。
   - goform 成功后再请求 `GET /api/baseDeviceInfo`（`requests.js:432`），不设超时，失败静默忽略。
   - 合并（`requests.js:442-447`）：
     ```js
     { ...goform, ...baseDeviceInfo,
       battery: goform.battery_value || goform.battery_vol_percent || baseDeviceInfo.battery }
     ```
     `msisdn` 为空时用 `sim_msisdn` 回填（`requests.js:438-440`，注释为 U30Air 兼容）。
   - 任何异常返回 `null`（`requests.js:448-454`），本轮不渲染。
2. `handlerStatusRender()`（`main.js:866`）拿到合并对象 `res` 后：
   - `res.is_reached_data_flow_limit` 为真 → toast 一次「流量超限，已自动关闭数据连接！」（`main.js:898-901`，`zh.json:855`）。
   - `res.loginfo != 'ok'` → 自动 `login()` 重登录；连续失败 3 次清除口令并弹登录框（`main.js:903-941`）。
   - `res.imei` 为空且高级功能可用 → 通过 root shell 执行 `imei_reader` 回填，缓存 5 分钟（`main.js:833-854`、`main.js:944-954`）。
   - 所有键写入 `window.UFI_DATA`。它是 Proxy，每次赋值都会调用 `chartUpdater` 刷新图表（`main.js:46-52`、`main.js:956-958`、`charts.js:2-74`）。
   - 注入 `res.QORS_MESSAGE`（AT 解析后的 QCI 文本，见 2.5）（`main.js:1005-1007`）。
   - 渲染三段：基本状态 `statusHtml_base`、信号参数 `statusHtml_net`、设备属性 `statusHtml_other`（`main.js:1018-1101`）。

**判空规则**：原版用 `notNullOrundefinedOrIsShow(obj, key)`（`main.js:444-452`）决定字段是否显示：

- `typeof === 'number'`：只要字段名在 showList 里就显示，**数字 0 也显示**；
- 其它类型：要求 `!= null && != undefined && != ''`，且字段名在 showList 里。**空字符串就是"无值"**。

showList 默认值见 `main.js:176-363`，用户可在「管理字段」中拖拽和勾选（`index.html:590-703`），保存在 `localStorage.showList`。

### 1.2 39 个 cmd 字段

`requests.js:417` 的 cmd 按逗号拆开是 **39 项**（`API_Doc.md` §3.13 写 38 个，是计数错误，没有遗漏字段）。

「示例」列：标【截图】的是截图A/C/H 中可见的值，其余为【推断】示例。goform 值类型：开关、文本类大概率是字符串（原版大量 `== '1'` 比较）；`monthly_*_bytes` 推断为 number（见 7.2）。新前端应把所有数值字段统一当 `string | number` 处理。

| # | 字段 | 示例 / 格式 | 单位 | 原版用途（解析与显示） | 出处 |
| --- | --- | --- | --- | --- | --- |
| 1 | `usb_port_switch` | `"0"` / `"1"` | — | 高级页"USB 调试状态"（`== '1'`） | `main.js:4483` |
| 2 | `battery_charging` | `"1"` / `"0"` | — | `== "1"` → 标签"正在充电"，否则"电池电量" | `main.js:1022` |
| 3 | `sms_received_flag` | 推断 `"0"` | — | 未使用 | — |
| 4 | `sms_unread_num` | `"2"` | 条 | 短信按钮未读徽标，>99 显示 `99+` | `main.js:1008-1015` |
| 5 | `sms_sim_unread_num` | 推断 `"0"` | 条 | 未使用 | — |
| 6 | `sim_msisdn` | 手机号或 `""` | — | 只用于回填 `msisdn` | `requests.js:438-440` |
| 7 | `dual_sim_support` | `"0"` / `"1"` | — | QCI 查询时选择 AT 槽位 | `main.js:3259-3272` |
| 8 | `sim_slot` | `"0"` `"1"` `"2"` `"11"` `"12"` | — | QCI 查询时的 AT 槽位映射（见 2.5） | `main.js:3246-3291` |
| 9 | `data_volume_limit_switch` | `"0"` / `"1"` | — | `== '1'` 时显示"总流量" | `main.js:1028` |
| 10 | `battery_value` | 【截图】`"81"` | % | 合并为 `battery` | `requests.js:446` |
| 11 | `battery_vol_percent` | `"81"` | % | 同上，在 `battery_value` 为空时使用 | `requests.js:446` |
| 12 | `network_signalbar` | 推断 `"0"`–`"5"` | 格 | `rssi` 为空时的备选；只有 number 类型才会显示（见 2.4） | `main.js:1023` |
| 13 | `network_rssi` | 未知 | — | 未使用 | — |
| 14 | `cr_version` | 【截图】`"U30Air_SSV1.0.0B14"` | — | 设备属性"版本号"；高级页固件版本 | `main.js:1063`、`main.js:4482` |
| 15 | `iccid` | 20 位数字 | — | 显示；变化时清 IMEI 缓存 | `main.js:952`、`main.js:1064` |
| 16 | `imei` | 15 位数字 | — | 显示；为空时用 root 回填 | `main.js:944`、`main.js:1065` |
| 17 | `imsi` | 15 位，前 5 位为 PLMN | — | 显示 | `main.js:1066` |
| 18 | `ipv6_wan_ipaddr` | IPv6 字符串 | — | "IPV6地址" | `main.js:1067` |
| 19 | `lan_ipaddr` | 【截图】`"192.168.0.1"` | — | "本地网关" | `main.js:1068` |
| 20 | `mac_address` | `"xx:xx:xx:xx:xx:xx"` | — | "MAC" | `main.js:1069` |
| 21 | `msisdn` | 手机号或 `""` | — | "手机号" | `main.js:1070` |
| 22 | `network_information` | 未知 | — | **从不读取本键**；推断是展开信号字段的复合 cmd（见 1.3） | — |
| 23 | `Lte_ca_status` | 未知 | — | **请求了但从不读取**，原版不显示 CA | — |
| 24 | `rssi` | 【截图】`"5"` | 格（0–5） | "信号强度"格数 emoji，**不是 dBm**（见 2.4） | `main.js:1023` |
| 25 | `Z5g_rsrp` | 推断 `"-88"` | dBm | 5G 接收功率；当前小区 RSRP | `main.js:969`、`main.js:1049` |
| 26 | `lte_rsrp` | 【截图】`"-85"` | dBm | 4G 接收功率；当前小区 RSRP 回退 | `main.js:969`、`main.js:1039` |
| 27 | `wifi_access_sta_num` | 【截图】`"2"` | 台 | "WIFI连接" | `main.js:1021` |
| 28 | `loginfo` | `"ok"` | — | 不等于 `ok` 时自动重登录 | `main.js:903` |
| 29 | `data_volume_alert_percent` | `"80"` | % | 主页不用（流量管理弹窗另行查询） | — |
| 30 | `data_volume_limit_size` | 截图推断 `"800_1024"` | MB × 倍数 | 主页"总流量"（见 7.3） | `main.js:1028-1032` |
| 31 | `realtime_rx_thrpt` | 字节/秒 | B/s | 下行网速、网速图 | `main.js:1036`、`charts.js:7-9` |
| 32 | `realtime_tx_thrpt` | 字节/秒 | B/s | 上行网速、网速图 | `main.js:1036`、`charts.js:434` |
| 33 | `realtime_time` | 截图约 `99000` | 秒 | "连接时长" | `main.js:1027` |
| 34 | `monthly_tx_bytes` | 字节 | B | "已用流量" = tx + rx | `main.js:1028` |
| 35 | `monthly_rx_bytes` | 字节 | B | 同上 | `main.js:1028` |
| 36 | `monthly_time` | 截图约 `9.39e6` | 秒 | "总时长" | `main.js:1027` |
| 37 | `network_type` | 【截图】`"LTE"`；代码分支 `"20"` / `"13"` | — | 见 2.1 | `main.js:1020` |
| 38 | `network_provider` | 【截图】`"中国联通"` | — | 见 2.2 | `main.js:1020` |
| 39 | `ppp_status` | 推断 `"ppp_connected"` | — | 主页不用；数据开关另行查询（见 2.3） | `main.js:2768-2800` |

### 1.3 不在 cmd 列表里、但原版会读取的信号字段【代码 + 推断】

读取位置：当前小区 `main.js:966-971`，信号参数段 `main.js:1039-1057`。

```
5G：Z5g_rsrp*  Nr_snr   nr_rsrq   nr_rssi   Nr_bands   Nr_fcn   Nr_bands_widths   Nr_pci   Nr_cell_id
4G：lte_rsrp*  Lte_snr  lte_rsrq  lte_rssi  Lte_bands  Lte_fcn  Lte_bands_widths  Lte_pci  Lte_cell_id
（* 这两个在 cmd 列表里，其余 16 个不在）
```

- 【代码】这 16 个键在原版里**没有任何二次请求、JSON 解析、改名或单位换算**，直接以 `res.Nr_snr` 这样的形式从合并对象顶层读取。大小写混用（`Nr_` / `nr_` / `Lte_` / `lte_`）就是原始键名，Mock 必须逐字保留。
- 【后端】`/api/baseDeviceInfo` 的响应模板（`baseDeviceInfoModule.kt:183-209`）不含这些键，整个 Kotlin 后端也没有任何信号字段（全仓 grep `rsrp|sinr|network_type` 无结果）。
- 所以它们只能来自同一次 goform 响应。【推断】cmd 列表里"请求了却从不读取本键"的只有 `network_information` 和 `Lte_ca_status`，据此推断中兴固件把 `network_information` 当复合 cmd，在**响应顶层平铺**返回上面 16 个键。
- 【截图A/H】U30 Air 4G 驻留时 4G 键有值，5G 键整行不显示，说明 5G 键为 `""` 或缺失。
- Mock 建议：把这 16 个键平铺进主页轮询响应顶层；未驻留的制式给 `""`；`network_information` 本键给 `""`。真机上该键本身是否存在、值是什么，需抓包确认。

### 1.4 轮询频率与触发方式【代码】

- `REFRESH_TIME`：取 `localStorage.refreshRate`，缺省 1000 ms（`utils.js:647-658`、`main.js:34-37`）。下拉可选 5000 / 3000 / 2500 / 2000 / 1900 / 1700 / 1500 / 1300 / 1000 / 900 / 800 / 700 / 600 / 500 / 400 / 300 / 200 / 100 ms（`index.html:225-245`）。
- 定时器：`requestInterval(fn, ms)`（`utils.js:61-81`）基于 `requestAnimationFrame` 计时。两个后果：① 不等上一轮请求结束，慢网时请求会并发叠加；② 标签页切到后台时 rAF 暂停，轮询随之停止。
- 启动：`handlerStatusRender(true)`（首轮显示 loading），然后 `StopStatusRenderTimer = requestInterval(..., REFRESH_TIME)`（`main.js:1104-1105`）。
- 「停止刷新 / 开始刷新」按钮（`.REFRESH_BTN`）同时停止或恢复主页轮询和 QCI 轮询（`main.js:2122-2148`）。修改刷新频率时先停再启，并写入 localStorage（`main.js:5305-5315`）。
- 每轮 2 个串行请求：goform（5 s 超时）→ `/api/baseDeviceInfo`（无超时）。
- 后端采样节流：CPU 使用率最短 100 ms 采样一次，温度最快 1 s 采样一次（`DeviceInfo.kt:49-52`、`DeviceInfo.kt:105-119`、`DeviceInfo.kt:335-341`）。刷新间隔小于 1 s 时温度不会变化。

### 1.5 `/api/baseDeviceInfo` 解析

#### 1.5.1 响应是用字符串模板拼出来的【后端】

`baseDeviceInfoModule.kt:183-209` 用 Kotlin 字符串模板拼 JSON，导致：

1. 模板里带引号的字段（`app_ver`、`app_ver_code`、`model`、`battery`、`client_ip`）永远是字符串；采集失败时变成**字符串 `"null"`**，不是 JSON `null`。
2. 不带引号的字段（数字、布尔、嵌入 JSON）采集失败时是 JSON `null`。
3. `cpu_temp_list`、`cpuFreqInfo`、`cpuUsageInfo`、`memInfo` 在 Kotlin 里是 String，但拼接时**没有加引号**，所以 HTTP 响应里它们是**嵌入的 JSON 数组 / 对象，不是字符串**。`API_Doc.md:230`、`API_Doc.md:235-237` 写成字符串，与实际不符。前端 `charts.js:20`、`charts.js:51`、`charts.js:61` 也是直接当数组 / 对象使用。

#### 1.5.2 字段表

| 字段 | 类型 | 示例 | 单位 | 原版解析与显示 | 出处 |
| --- | --- | --- | --- | --- | --- |
| `app_ver` | string | `"4.1.3"` | — | 仪表盘未用 | `baseDeviceInfoModule.kt:185` |
| `app_ver_code` | string | `"20260908"` | — | 仪表盘未用 | `:186` |
| `model` | string | 【截图A】`"U30 Air"` | — | 设备属性"设备型号"；QCI 槽位映射里判断 `"MU3356"`（F50 Pro） | `main.js:1062`、`main.js:3278` |
| `battery` | string | `"81"` | % | 被 goform 电量覆盖（见 1.1） | `requests.js:446` |
| `daily_data` | number \| null | `267774853` | B | "当日流量" `formatBytes` | `main.js:1033` |
| `monthly_data` | number \| null | `55029268480` | B | "/ 本月已用：" | `main.js:1033` |
| `internal_available_storage` / `internal_used_storage` / `internal_total_storage` | number \| null | 截图A 为 5.42 GB / 23.27 GB | B | "内置存储：X 已用 / Y 总容量" | `main.js:1071` |
| `external_*_storage` | number \| null，无 SD 卡为 0 | `0` | B | "SD卡"，0 也会显示 `0.00 B` | `main.js:1072` |
| `cpu_temp_list` | 嵌入数组 \| null | `[{"type":"soc-thmzone","temp":39930}]` | `temp` 为 m℃ | 温度详情弹窗（见 1.5.3） | `charts.js:59-72` |
| `cpu_temp` | number \| null | `40650`；无传感器 `-1` | **m℃（毫摄氏度）** | `(cpu_temp/1000).toFixed(2) + " ℃"`；温度图同样除以 1000 | `main.js:1024`、`charts.js:340`、`charts.js:346` |
| `client_ip` | string | 【截图A】`"192.168.0.253"` | — | "客户端IP" | `main.js:1061` |
| `cpu_usage` | number \| null | `1.4` | % | `toFixed(2)`；CPU 图 `Math.floor` | `main.js:1025`、`charts.js:132` |
| `mem_usage` | number | `59.7` | % | `toFixed(2)`；内存图 `Math.floor` | `main.js:1026`、`charts.js:264` |
| `cpuFreqInfo` | 嵌入对象 \| null | `{"cpu0":{"cur":2002,"max":2002}}` | MHz | CPU 频率条（见 1.5.3） | `charts.js:16-44` |
| `cpuUsageInfo` | 嵌入对象 \| null | `{"cpu":"1.4","cpu0":"2.0"}` | %（**值是字符串**） | 核心使用率柱图 | `charts.js:45-47`、`charts.js:197-209` |
| `memInfo` | 嵌入对象 \| null | 见 1.5.3 | KB | 内存详情弹窗 | `charts.js:48-58` |
| `current_now` | number | `3000`；读取失败 `-1` | **µA** | `current_now / 1000 + " mA"`（不取整） | `main.js:1034` |
| `voltage_now` | number | `3936000`；读取失败 `-1` | **µV** | `(voltage_now / 1e6).toFixed(3) + " V"` | `main.js:1035` |
| `is_reached_data_flow_limit` | boolean | `false` | — | 为 true 时 toast 一次 | `main.js:898-901` |
| `boot_time` | number | `275112000` | **ms，开机时长**（`elapsedRealtime`，不是时间戳） | "开机时长：D 天 HH 时 MM 分 SS 秒" | `main.js:1073`、`utils.js:1570-1591`、`baseDeviceInfoModule.kt:181` |

`boot_time` 在 `API_Doc.md` 的字段表中没有列出。

#### 1.5.3 嵌入结构

**`cpuFreqInfo`**【后端 `DeviceInfo.kt:85-103`】

```json
{ "cpu0": { "cur": 2002, "max": 2002 }, "cpu1": { "cur": 2002, "max": 2002 } }
```

- `cur` = `scaling_cur_freq ÷ 1000`（kHz 转 MHz），`max` = `cpuinfo_max_freq ÷ 1000`；文件不存在时为 0。
- 【代码】前端从 `cpu0` 起按编号递增遍历，**遇到第一个缺失的编号就停止**（`charts.js:20`），所以编号必须连续。
- 如果 `cpuUsageInfo` 里没有 `cpuN` 键，该核按离线处理，频率显示 0（`charts.js:24-30`）。
- 每核一个条：`kano_parseSignalBar(cur, 0, max, max*0.9, max*0.9, { g:'#ffa5008f', o:'#ffa5008f', r:<主题色> })`，达到 max 的 90% 显示橙色，否则显示主题色（`charts.js:35-39`）。
- 【截图B】8 个核：4 核 2002 MHz（橙），3 核 768 MHz，1 核显示 0（离线）。

**`cpuUsageInfo`**【后端 `DeviceInfo.kt:105-144`】

```json
{ "cpu": "1.4", "cpu0": "2.0", "cpu1": "1.0", "cpu6": "2.0" }
```

- 值是 `"%.1f"` 格式化后的**字符串**；`cpu` 键是总体使用率，与顶层 `cpu_usage` 同源；离线核心不会出现在 `/proc/stat`，因此会缺键。
- 前端核心柱图固定 8 柱（cpu0–cpu7），取 `Math.round(value['cpuN'])`，缺键为 0（`charts.js:151`、`charts.js:197-205`）。

**`memInfo`**【后端 `DeviceInfo.kt:167-198`】

```json
{ "mem_total_kb": 1502956, "mem_available_kb": 606249, "mem_used_kb": 896707, "mem_usage_percent": "59.7",
  "swap_total_kb": 931830, "swap_free_kb": 357059, "swap_used_kb": 574771, "swap_usage_percent": "61.7" }
```

- `*_kb` 为 number（KB）；两个 `*_percent` 是**字符串**。
- 前端弹窗：各 `*_kb × 1024` 后 `formatBytes`，百分比 `Math.round`（`charts.js:51-56`）。
- 【截图D】内存(全部) 1.43 GB / 可用 592.04 MB / 已用 875.69 MB(60%) / 全部 SWAP 909.99 MB / 已用 561.30 MB(62%) / 可用 348.69 MB。上面的示例数值就是按这组截图反推的。

**`cpu_temp_list`**【后端 `DeviceInfo.kt:75-82`、`DeviceInfo.kt:236-263`、`DeviceInfo.kt:301-324`、`DeviceInfo.kt:335-361`】

```json
[ { "type": "soc-thmzone", "temp": 39930 }, { "type": "nr0-thmzone", "temp": 38650 } ]
```

- 数据来自 `/sys/class/thermal/thermal_zone*/{type,temp}`。type 含 `chg` / `front` / `frame` / `wcn` / `usb` / `bcl` / `interface` / `skin` / `back` 的 zone 被过滤；只保留 0–124000 范围的读数。
- `cpu_temp` = 列表中最大的 `temp`；列表为空时为 `-1`（前端会显示 `-0.00 ℃`）。
- 前端：按 `type` **首字符** `localeCompare` 排序，`type.replace('-thmzone','')`，`temp / 1000` 保留两位，两列网格显示（`charts.js:59-72`）。
- 【截图E】可见 zone 名（已去后缀）：ai0、ai1、apcpu0、apcpu1、big7、big7mid4、board、gpu、lit0–lit3、lte、mid4、mid5、mid5mid6、mid6、mm、nr、nr0、nr1、pa、soc。截图还含 chg、interface，说明拍摄时后端版本较旧，当前后端已将其过滤。
- 【推断】原始 `type` 带 `-thmzone` 后缀，因为前端专门做了 replace。

#### 1.5.4 电流、电压与充电判断

- `current_now`：µA，来自 `/sys/class/power_supply/battery/current_now`，读取失败为 `-1`；整个电池采集块异常时为 `null`（`DeviceInfo.kt:364-403`、`baseDeviceInfoModule.kt:157-179`）。显示 `current_now / 1000 + " mA"`，会出现 `3.123 mA` 这类小数。
- `voltage_now`：µV。显示 `(voltage_now / 1e6).toFixed(3) + " V"`。
- 两者的显示条件：字段在 showList 中，且 `battery_value != '' || battery_vol_percent != ''`（`main.js:1034-1035`）。
- **充电状态只看 goform 的 `battery_charging == "1"`**（`main.js:1022`），**不看电流正负**。
  - 【截图A】充电中，电流显示 `3 mA`（正值）。【推断】这台机器正值表示充电流入，但 Android 各厂商的符号约定不统一，不建议用正负号判断充电。
- 电量：合并后的 `battery` → `kano_parseSignalBar(battery, 1, 100, 50, 10, 默认色, " %")`，≥ 50 绿、10–49 橙、< 10 红（`main.js:1022`）。
- 关机按钮仅在 `battery_value` 与 `battery_vol_percent` **都非空**时显示（`main.js:3060-3071`）。

### 1.6 「基本状态」卡片显示公式【代码】`main.js:1018-1037`

| showList 名 | 中文标签 | 显示公式 | 行号 |
| --- | --- | --- | --- |
| `QORS_MESSAGE` | （无前缀） | 见 2.5，如 `QCI：9 ⬇️ 150Mbps ⬆️ 50Mbps` | 1019 |
| `network_type` | 网络状态： | `${network_provider} ${network_type=='20'?'5G':network_type=='13'?'4G':network_type}` | 1020 |
| `wifi_access_sta_num` | WIFI连接： | 原值 | 1021 |
| `battery` | 正在充电： / 电池电量： | 信号条 `(1,100,50,10)` + `" %"` | 1022 |
| `rssi` | 信号强度： | `kano_getSignalEmoji(rssi 或 network_signalbar)` | 1023 |
| `cpu_temp` | CPU温度： | `(cpu_temp/1000).toFixed(2)` ℃ | 1024 |
| `cpu_usage` | CPU占用： | `toFixed(2)` % | 1025 |
| `mem_usage` | 内存占用： | `toFixed(2)` % | 1026 |
| `realtime_time` | 连接时长： | `kano_formatTime(realtime_time)`；`monthly_time` 有值时追加 ` / 总时长: kano_formatTime(monthly_time)` | 1027 |
| `monthly_tx_bytes` | 已用流量： | `formatBytes(Number(tx + rx))`（先加后转数字，见 7.2）；满足条件时追加 ` / 总流量：…` | 1028-1032 |
| `daily_data` | 当日流量： | `formatBytes(daily_data)`；`monthly_data` 有值时追加 ` / 本月已用：formatBytes(monthly_data)` | 1033 |
| `current_now` | 电池电流： | `current_now/1000` mA | 1034 |
| `voltage_now` | 电池电压： | `(voltage_now/1e6).toFixed(3)` V | 1035 |
| `realtime_rx_thrpt` | 当前网速: | `⬇️ formatBytes(rx)/S ⬆️ formatBytes(tx)/S` | 1036 |

通用格式化函数：

- `formatBytes`（`utils.js:167-183`）：1024 进制，两位小数，单位 B / KB / MB / GB / TB…。只有严格等于 number `0` 时返回 `" 0.00 B"`；字符串 `"0"`、负数、NaN 都会输出 `NaN undefined`。
- `kano_formatTime`（`utils.js:157-165`）：< 60 → `N 秒`；< 3600 → `N.N 分钟`；否则 `N.N 小时`。
- `formatBootTime`（`utils.js:1570-1591`）：毫秒转 `D 天 HH 时 MM 分 SS 秒`。

---

## 2. 网络制式与运营商

### 2.1 `network_type`

- 来源：主页轮询 cmd 第 37 项。
- 【代码】原版唯一的解析（`main.js:1020`）：`'20'` → `5G`，`'13'` → `4G`，**其它值原样显示**。用 `==` 比较，数字和字符串都能匹配。
- 【截图A】U30 Air 4G 驻留时显示「网络状态：中国联通 LTE」，说明该机返回字符串 `"LTE"`，不是 `"13"`。
- 【推断】`20` / `13` 与 Android `TelephonyManager.NETWORK_TYPE_NR(20)` / `NETWORK_TYPE_LTE(13)` 一致，说明至少有一种机型或固件直接返回 Android 网络类型常量；另一些返回名称字符串。5G 下的名称（`"SA"` / `"NSA"` / `"ENDC"` / `"NR5G"` 等）、无服务时的取值，**都没有证据**。
- 【代码】**原版不区分 5G SA 与 5G NSA**：输出只有"5G / 4G / 原样字符串"三种，全局也没有任何 SA / NSA 判断逻辑。新前端的分类建议见 2.6。

### 2.2 `network_provider`

- 【代码】原样拼在制式前面（`main.js:1020`），没有任何映射。
- 【截图A】`"中国联通"`，即中文全称。
- 【推断】其它运营商为 `"中国移动"` / `"中国电信"` / `"中国广电"`，也可能出现英文名。新前端原样展示即可。如需识别运营商，可以用 `imsi` 前 5 位兜底（46000 / 46002 / 46004 / 46007 / 46008 = 移动，46001 / 46006 / 46009 = 联通，46003 / 46005 / 46011 = 电信，46015 = 广电）。这是通用 PLMN 知识，不是原版逻辑。

### 2.3 `ppp_status`

- 主页轮询会带回这个字段，但主页渲染不用它。
- 【代码】只用于「数据开关」按钮：单独请求 `cmd=ppp_status`（`main.js:2768-2770`）。值 `== 'ppp_disconnected'` 时按钮不高亮，点击发 `CONNECT_NETWORK`；**其它任何值**都当作已连接，点击发 `DISCONNECT_NETWORK`（`main.js:2784`、`main.js:2800`）。操作成功 2 s 后刷新按钮和 QCI（`main.js:2787-2791`）。
- 【截图F】数据开关按钮是高亮的，说明当时的值不是 `ppp_disconnected`，具体值不可见。
- 【推断】中兴固件常见取值：`ppp_connected`、`ppp_connecting`、`ppp_disconnecting`、`ppp_disconnected`，以及 IPv6 相关的 `ipv6_connected`、`ipv4_ipv6_connected` 等。原版代码只实证了 `ppp_disconnected`。新前端可按此处理：`ppp_disconnected` 为已断开；包含 `connecting` / `disconnecting` 为过渡态；其余为已连接。

### 2.4 `rssi` / `network_signalbar` / `network_rssi`（信号格数）

- 【代码】「信号强度」一栏（`main.js:1023`）优先用 `rssi`，否则用 `network_signalbar`，传给 `kano_getSignalEmoji`（`utils.js:152-155`）：
  ```js
  const signals = ["📶 ⬜⬜⬜⬜", "📶 🟨⬜⬜⬜", "📶 🟩🟨⬜⬜", "📶 🟩🟩🟨⬜", "📶 🟩🟩🟩🟨", "📶 🟩🟩🟩🟩"];
  return `${strength} ${signals[Math.max(0, Math.min(strength, 5))]}`;
  ```
  也就是把值当作 **0–5 格**。
- 【截图A】显示「信号强度：5 📶 🟩🟩🟩🟩」，证实 `rssi` 是**格数，不是 dBm**。同一屏的「4G RSSI：-59」来自 `lte_rssi`。
- 坑：`network_signalbar` 不在 showList 里，`notNullOrundefinedOrIsShow(res, 'network_signalbar', true)` 只在它是 **number** 时为真。如果固件返回字符串，只有 `rssi` 非空时这一栏才会显示（`main.js:444-452`、`main.js:1023`）。
- `network_rssi`：请求了但从未使用，含义未知。

### 2.5 QCI 与签约速率（`QORS_MESSAGE`）

- 【代码】`QOSRDPCommand("AT+CGEQOSRDP=1")`（`main.js:3244-3302`）→ `GET /api/AT?command=AT%2BCGEQOSRDP%3D1&slot=<n>`（`main.js:3226-3242`）。
- AT 槽位映射（`main.js:3269-3299`）：
  - `dual_sim_support != '1'` 或 `sim_slot` 为空 → slot 0；
  - `sim_slot == "11"`（外置卡）→ 0；但 `model == "MU3356"`（F50 Pro）时 → 1；
  - `"2"` → 1；`"12"` → 0；
  - 单卡机型结果含 `ERROR` → 改用 slot 1 再试一次。
- `/api/AT` 响应【后端 `atModule.kt:50-61`】：`{"result":"..."}`，换行和回车直接删除（不替换成空格），末尾 `ok` 规范成 `" OK"`；失败时 HTTP 500，`{"error":"AT指令执行错误：…"}`。
- 解析（`main.js:3212-3223`）：正则 `/\+CGEQOSRDP:\s*(.+?)\s*OK/`，逗号拆分后转数字，至少 8 段；输出 `QCI：${p[1]} ⬇️ ${p[6]/1000}Mbps ⬆️ ${p[7]/1000}Mbps`（`p[6]` / `p[7]` 为下行 / 上行 AMBR，单位 kbps）。不匹配时原样返回整段 AT 文本。
- 【截图A】`QCI：9 ⬇️ 150Mbps ⬆️ 50Mbps`；`index.html:1631` 的注释给出原始响应示例 `+CGEQOSRDP: 1,6,0,0,0,0,1000000,300000`。
- 频率：加载 1 次 + 每 10 s（`main.js:3303-3304`、`main.js:2124`）；切网后每秒 1 次，最多 20 次，直到结果不含 ERROR（`main.js:1339-1348`）；切卡、数据开关后各 1 次。

### 2.6 新前端区分 SA / NSA / LTE 的建议（【推断】，原版没有这段逻辑）

以"哪组字段非空"为主，`network_type` 为辅：

| NR 组非空 | LTE 组非空 | 常见 `network_type` | 判定 |
| --- | --- | --- | --- |
| 是 | 否 | `"20"`、推断 `"SA"` | 5G SA |
| 是 | 是 | 推断 `"13"` / `"20"` / `"ENDC"` / `"NSA"` | 5G NSA（LTE 锚点 + NR 辅载波，EN-DC） |
| 否 | 是 | `"13"`、【截图】`"LTE"` | 4G LTE |
| 否 | 否 | 任意 | 无服务或未知，再结合 `ppp_status` 判断 |

- NR 组 = `Z5g_rsrp` / `Nr_pci` / `Nr_fcn`；LTE 组 = `lte_rsrp` / `Lte_pci` / `Lte_fcn`；"非空"指非 `null` / `undefined` / `""`，与原版判空一致。
- 依据只有"截图里 4G 驻留时 5G 字段为空"这一条的镜像推断。SA 下 LTE 组是否一定为空、NSA 下两组是否同时有值，都需要真机确认。

---

## 3. 射频指标

### 3.1 4G / 5G 字段对照（都在主页轮询响应顶层）

| 指标 | 4G 字段 | 5G 字段 | 格式 / 单位 | 原版显示 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 接收功率 RSRP | `lte_rsrp`（cmd #26） | `Z5g_rsrp`（cmd #25） | 数字字符串，dBm；【截图】`"-85"` | 信号条（默认阈值） | `main.js:1039`、`main.js:1049` |
| SINR | `Lte_snr` | `Nr_snr` | dB；【截图】`"4"` / `"3"` | 信号条 `(-10, 30, 13, 0)` | `main.js:1040`、`main.js:1050` |
| RSRQ | `lte_rsrq` | `nr_rsrq` | dB；【截图】`"-10"` / `"-9"` | 信号条 `(-20, -3, -9, -12)` | `main.js:1045`、`main.js:1055` |
| RSSI | `lte_rssi` | `nr_rssi` | dBm；【截图】`"-59"` / `"-61"` | 原样文本，不画条 | `main.js:1046`、`main.js:1056` |
| 注册频段 | `Lte_bands` | `Nr_bands` | 纯数字；【截图】`"8"` | 加前缀 `B` / `N`：`B8`、`N41` | `main.js:1041`、`main.js:1051` |
| 频点 | `Lte_fcn`（EARFCN） | `Nr_fcn`（NR-ARFCN） | 整数；【截图】`"3740"` | 原样 | `main.js:1042`、`main.js:1052` |
| 带宽 | `Lte_bands_widths` | `Nr_bands_widths` | 【截图】4G 为 `"10000"`，推断单位 kHz（即 10 MHz）；5G 推断同为 kHz（`"100000"` = 100 MHz） | 原样，不加单位 | `main.js:1043`、`main.js:1053` |
| PCI | `Lte_pci` | `Nr_pci` | 整数，LTE 0–503，NR 0–1007；【截图】`"143"` | 原样 | `main.js:1044`、`main.js:1054` |
| 小区 ID | `Lte_cell_id` | `Nr_cell_id` | 【截图】4G 为 8 位十进制整数串；5G 推断为十进制（NCI 36 bit，最多 11 位） | 原样 | `main.js:1047`、`main.js:1057` |
| CA 状态 | `Lte_ca_status`（cmd #23） | — | 未知 | **未使用** | — |
| 信号格数 | `rssi` / `network_signalbar` | 同左 | 0–5 | emoji 格 | `main.js:1023` |

截图A/H 的实测组合（U30 Air，中国联通 B8）：RSRP -85、SINR 4、RSRQ -10、频段 B8、频点 3740、带宽 10000、PCI 143、RSSI -59。按 B8 公式 `925 + 0.1 × (3740 − 3450) = 954 MHz`，与联通 B8 下行频率吻合。

### 3.2 信号分级阈值与颜色：`kano_parseSignalBar`（`utils.js:117-150`）

签名：`kano_parseSignalBar(val, min=-125, max=-81, green_low=-90, yellow_low=-100, config={g:'green', o:'orange', r:'red'}, suffix='')`

- 进度：`strength = clamp(Number(val), min, max)`；`percent = (第一个 ≥ strength 的整数下标 + 1) / (|max − min| + 1) × 100`，约等于 `(ceil(strength) − min + 1) / (max − min + 1)`。
- 颜色：`strength ≥ green_low` → g；`≥ yellow_low` → o；否则 r。进度条 `opacity: .6`、`transition: all .5s`；条上文字是**原始 val**，不取整，不加单位。
- 非数字字符串得到 NaN，结果为宽度 0 的红条。

| 用途 | 调用参数 | 绿 | 橙 | 红 | 条范围 | 出处 |
| --- | --- | --- | --- | --- | --- | --- |
| RSRP（4G / 5G / 当前小区 / 邻区） | 默认 | ≥ -90 | -100 ≤ x < -90 | < -100 | [-125, -81] | `main.js:994`、`main.js:1039`、`main.js:1049`、`main.js:1859` |
| SINR | `(-10, 30, 13, 0)` | ≥ 13 | 0 ≤ x < 13 | < 0 | [-10, 30] | `main.js:995`、`main.js:1040`、`main.js:1050`、`main.js:1860` |
| RSRQ | `(-20, -3, -9, -12)` | ≥ -9 | -12 ≤ x < -9 | < -12 | [-20, -3] | `main.js:996`、`main.js:1045`、`main.js:1055`、`main.js:1861` |
| 电量 | `(1, 100, 50, 10, 默认色, " %")` | ≥ 50 | 10 ≤ x < 50 | < 10 | [1, 100] | `main.js:1022` |
| CPU 频率 | `(0, max, 0.9max, 0.9max, 橙/橙/主题色)` | — | ≥ 90% max 橙 | 其余主题色 | [0, max] | `charts.js:35-39` |

- 原版只有 3 档（绿 / 橙 / 红）。`CLAUDE.md` 要求的「极佳 / 良好 / 一般 / 微弱」4 档需要新定义第 4 个阈值，原版没有现成数值。
- `utils.js:116` 的注释写"-113 到 -51"，与默认参数 [-125, -81] 不符，以参数为准。
- 【截图A/H】RSRP -85 / -86 为绿，SINR 3 / 4 为橙，RSRQ -9 为绿、-10 为橙，与上表一致。

### 3.3 当前小区（「锁定基站」区块里的「当前基站」行）【代码】`main.js:963-1002`

- 每轮主页轮询时合成（"或"指按 `notNullOrundefinedOrIsShow` 判空，**5G 优先**）：
  ```
  PCI  = Nr_pci   或 Lte_pci
  FCN  = Nr_fcn   或 Lte_fcn
  BAND = Nr_bands ? "N"+Nr_bands : Lte_bands ? "B"+Lte_bands : ""
  RSRP = Z5g_rsrp 或 lte_rsrp
  SINR = Nr_snr   或 Lte_snr
  RSRQ = nr_rsrq  或 lte_rsrq
  ```
- PCI 或 FCN 为空 → 显示「当前未连接基站」（`zh.json:122`）。
- 点击该行或「选择当前基站」按钮 → `onSelectCellRow(PCI, FCN)`，只填 PCI / EARFCN 输入框，**不切换 4G / 5G 单选**（`main.js:984-986`、`main.js:1920-1928`）。
- 【截图H】当前基站行：B8 / 3740 / 143 / -86 / 4 / -9。
- 【推断】NSA 下由于 5G 优先，"当前基站"显示的是 NR 辅小区，而不是 LTE 锚点小区。

### 3.4 CA（载波聚合）

- 原版请求了 `Lte_ca_status` 但从不读取，界面没有 CA 展示。
- 也没有多频段解析：`Lte_bands` / `Nr_bands` 只当单个数字加 `B` / `N` 前缀显示。【推断】如果固件在 CA 时返回 `"3,1"` 这样的多值，原版会显示成 `B3,1`。

---

## 4. 选网模式

- **读取**【代码】：`getData(cmd=net_select)`（`main.js:1327-1329`，未带 `multi_data`）。拿 `res.net_select` 与下拉的 `option.value` 逐个比较，相等则选中（`main.js:1334-1338`）。值不在列表里时下拉停在第一项「5G/4G/3G」，**会显示错误的当前模式**。
- **写入**：`goformId=SET_BEARER_PREFERENCE&BearerPreference=<值>`（`main.js:1365-1368`），成功返回 `{"result":"success"}`。无论成败都会重读 `net_select`，并触发 QCI 刷新（`main.js:1374`、`main.js:1339-1348`）。
- **选项**（`index.html:133-140`、`zh.json:39-44`）：

| `BearerPreference` / `net_select` 值 | 原版标签 | i18n key |
| --- | --- | --- |
| `WL_AND_5G` | 5G/4G/3G | `net_auto` |
| `LTE_AND_5G` | 5G NSA | `net_nsa` |
| `Only_5G` | 5G SA | `net_sa` |
| `WCDMA_AND_LTE` | 4G/3G | `net_4g_3g` |
| `Only_LTE` | 仅4G | `net_4g` |
| `Only_WCDMA` | 仅3G | `net_3g` |

- 定时任务的动作模板只提供 `WL_AND_5G` / `LTE_AND_5G` / `Only_5G` / `Only_LTE` 四个（`main.js:5622-5637`）。
- 【截图F】下拉中可见以上 6 个标签。
- 【推断】`net_select` 的读取值域与 `BearerPreference` 的写入值域相同，原版就是按这个假设做匹配的。
- **没有二次确认**：`<select onchange>` 立即提交，先 toast「更改中，请稍后」（颜色 `#BF723F`）（`main.js:1357`、`zh.json:484`）。

---

## 5. 频段锁

### 5.1 频段全集

**4G：写死在 `index.html:292-356`**，共 9 个，每行是 `<input type="checkbox" data-type="4G" data-band="1">`：

| 频段 | 频率列 | 制式 | 运营商（原版文案） |
| --- | --- | --- | --- |
| B1 | 2100 | FDD-LTE | 联通/电信 |
| B3 | 1800 | FDD-LTE | 三大运营商 |
| B5 | 850 | FDD-LTE | 电信 |
| B8 | 900 | FDD-LTE | 移动 |
| B34 | 2000 | TD-LTE | 移动 |
| B38 | 2600 | TD-LTE | 移动 |
| B39 | 1900 | TD-LTE | 移动 |
| B40 | 2300 | TD-LTE | 移动 |
| B41 | 2500–2690 | TD-LTE | 移动 |

（B8 原版只写了"移动"，但截图A 中联通也在用 B8，此处照录原文案。）

**5G：由接口动态获取**

- 请求：`GET /api/getSupportNrBandList?slot=<#AT_SLOT 下拉值，默认 0>`（`main.js:1685-1693`）。
- 返回【后端 `atModule.kt:83-119`】：`{"slot":0,"band_list":[1,3,5,8,28,41,78,79]}`，整数数组，已去重，保持 AT 输出顺序。数据来自 `AT+SP5GCMDS="get nr support_band"`。**结果在进程内缓存，且不区分 slot**：服务启动后第一次查询的是哪个槽位，之后一直返回那次的结果。失败时 HTTP 500，`{"error":"getSupportNrBandList 错误：…"}`。
- 前端 `renderBandList`（`main.js:1645-1669`）：去掉 `n` 前缀、转整数、去重、只留正整数、**升序排序**后渲染。接口失败或数组为空时回退 `DEFAULT_NR_5G_BANDS = [1, 5, 8, 28, 41, 78]`（`main.js:1643`、`main.js:1698-1701`）。
- 每行的文字取自静态表 `NR5G_BANDS`（`utils.js:1491-1568`），例如 n41 显示 `N41`、`2496–2690`、`TDD`、运营商 i18n `5g.band.n41` = 「移动/广电」。表里没有的频段只显示 `N{号}`。
- 【截图G】拍摄时的版本 5G 也是写死的：可见 N1 / N5 / N8 / N28 / N41 / N78，与当前的回退列表一致，但频率范围文字与当前 `NR5G_BANDS` 不同，以代码为准。

### 5.2 读取格式【代码】

- 请求：`getData(cmd=lte_band_lock,nr_band_lock)`（`main.js:1676-1678`）。
- 两个字段都是**逗号分隔的纯数字字符串，无 B / n 前缀，无空格**。前端 `split(',')` 后按 `data-band="${band}"` 精确匹配勾选（`main.js:1708-1727`）。值里有表外频段（例如 4G 的 B28）时**静默忽略**。
- 空串或缺失 → 全部不勾选。勾选完后 `checkBandSelect()` 同步表头的全选框（`utils.js:757-776`）。
- 【截图G】所有框都处于勾选状态。【推断】固件在"未锁频"时返回全集（例如 `"1,3,5,8,34,38,39,40,41"`）而不是空串；也可能截图拍于点过「解除锁频段」（提交全集）之后。两种情况都说明：**在原版语义里，"全选"就等于"不锁频"**。

### 5.3 提交与附加动作【代码】`main.js:1737-1825`

1. 收集勾选项：`data-type == "4G"` 放进 `lte_bands`，`"5G"` 放进 `nr_bands`。顺序跟随 DOM：4G 按表格顺序，5G 按升序。
2. `login()` 获取会话。
3. 依次发送两个写请求。代码包在 `Promise.all` 里，但每个调用都先 `await` 了，实际是**串行**：
   - `postData({ goformId: 'LTE_BAND_LOCK', lte_band_lock: lte_bands.join(',') })`
   - `postData({ goformId: 'NR_BAND_LOCK', nr_band_lock: nr_bands.join(',') })`
   - 每次 `postData` 内部还会先请求 `cmd=Language,cr_version,wa_inner_version` 和 `cmd=RD` 来计算 `AD`（`requests.js:292-319`）。
4. 判定：`res[0].result == 'success' || res[1].result == 'success'`，**任一成功就算成功**，toast「设置频段成功！」。
5. 成功后自动"重启网络栈"，没有提示也没有确认，走 `/api/AT`：
   ```
   AT+SFUN=5  slot=0   → 等待 100 ms
   AT+SFUN=5  slot=1   → 等待 100 ms
   AT+SFUN=4  slot=0   → 等待 100 ms
   AT+SFUN=4  slot=1
   ```
   `networkStackSwitch(flag)`：`flag=false` → `AT+SFUN=5`（关闭协议栈），`flag=true` → `AT+SFUN=4`（开启协议栈）（`main.js:1733-1735`）。也就是**先关后开、两个槽位都执行**，与当前 `sim_slot` 无关，AT 返回值不检查。被注释掉的旧方案是"切到另一个网络模式再切回来"（`main.js:1797-1813`）。
   - 【推断】`SFUN=5/4` 是展锐平台关闭 / 开启协议栈的指令；单卡机型对 slot 1 执行可能返回 ERROR，原版不处理。
6. 失败 toast「设置频段失败!」；`finally` 中重读频段（`initBandForm`）并取消按钮 loading（按钮内追加一个旋转的 🍥，`utils.js:1472-1489`）。
7. 原版允许一个都不勾直接提交，这时会发送空串 `lte_band_lock=` 和 `nr_band_lock=`。【推断】`API_Doc.md:792` 说"空为解锁"，但原版的「解除锁频段」并不走这条路，空串的真实效果需要真机确认。新前端应当禁止空提交，或者明确把它当作解锁并先确认。

### 5.4 解除锁频段 `main.js:1828-1836`

不是发空值。流程是：`toggleAllBandBox(true)` 勾选**当前表格里的所有频段**（4G 的 9 个 + 当前渲染出的 5G 列表），同步表头全选框，然后模拟点击「锁频段!」，完整走一遍 5.3（包括 SFUN 关开协议栈）。

---

## 6. 锁小区

### 6.1 数据结构【代码】

读取：`getData(cmd=neighbor_cell_info,locked_cell_info)`（`main.js:1843-1845`，未带 `multi_data`）。

**`neighbor_cell_info`：JSON 数组，不是字符串**。代码直接 `.length`、`.map` 并解构（`main.js:1849-1853`）。

- 每项原版用到的键：`band`、`earfcn`、`pci`、`rsrp`、`rsrq`、`sinr`。
- `band` 原样显示，**不加 B / N 前缀**，与当前小区行不同（`main.js:1856`）。【推断】为纯数字。
- `pci`、`earfcn` 被直接插进 `onclick="onSelectCellRow(${pci},${earfcn})"`（`main.js:1855`），所以必须是纯数字（字符串或数字均可），否则会生成非法 JS。
- `rsrp` / `sinr` / `rsrq` 按 3.2 的阈值画条。
- 原版**不读取** rat 或类型字段，无法区分 4G 和 5G 邻区。【推断】可能还有 rat 等其它键，未知。是否包含服务小区本身也未知，推断不包含。
- 空数组 → 显示「暂无邻区基站」（`zh.json:123`）；字段为空串或缺失 → **不更新表格**，保留上一次的内容（`main.js:1847`）。
- 【截图H】U30 Air 4G 时显示「暂无邻区基站」，说明至少可能返回空数组。

**`locked_cell_info`：JSON 数组**，每项 `earfcn`、`pci`、`rat`（`main.js:1872-1873`）。

- `rat == '12'` → 「4G」，**其它值一律显示「5G」**（`main.js:1876`）。
- 列顺序：类型 / PCI / 频率（`index.html:385-395`）。
- 空数组 → 「暂无被锁定的基站」（`zh.json:121`）。

**值类型**：数组项里是字符串还是数字没有证据。原版用 `==`、`Number()`、`isNaN()`，两种都能工作。Mock 用字符串（goform 惯例，推断）。

### 6.2 `CELL_LOCK` / `UNLOCK_ALL_CELL`【代码】

**锁定**：`postData({ goformId: 'CELL_LOCK', pci, earfcn, rat })`（`main.js:1951-1965`）

- `pci` = `#PCI` 输入框 trim 后的值；`earfcn` = `#EARFCN` 输入框 trim 后的值；`rat` = 选中的 `input[name=RAT]` 的 value。
- `rat` 取值：**`"12"` = 4G，`"16"` = 5G**（`index.html:441`、`index.html:444`，默认选中 16）。定时任务里的提示文案也写明「此处 锁5G填:16 锁4G填:12」（`zh.json:676`）。
- 校验只检查 pci、earfcn 非空（否则 toast「请填写完整数据」），**不校验是否为数字、取值范围，也不校验与 RAT 是否匹配**。
- 成功：清空两个输入框，toast「设置基站成功！」，只刷新已锁列表 `initCellInfo(true)`。失败：「设置基站失败!」。**锁小区后不会重启网络栈**。
- `User_Doc.md:1917-1924` 给的示例：`{"goformId":"CELL_LOCK","pci":"113","earfcn":"504990","rat":"16"}`（504990 是中国移动 n41 常见的 SSB 频点，约 2524.95 MHz）。

**解锁**：`postData({ goformId: 'UNLOCK_ALL_CELL' })`，没有其它参数（`main.js:1994-1996`）。成功「解锁基站成功！」并刷新已锁列表；失败「解锁基站失败!」。原版**没有解锁单个小区的功能**。

### 6.3 手动输入与点选【代码】

- 支持手动输入：PCI / EARFCN 是普通文本框（`index.html:447-458`），各带一个「重置」按钮（`resetInput`）。
- 点击邻区行、当前小区行或「选择当前基站」按钮，都只自动填写 PCI 和 EARFCN，并 toast「已选择: pci,earfcn」。**RAT 不会跟着变**，仍是用户当前的选择（默认 5G）。锁 4G 小区时用户必须手动切到 4G，否则会以 `rat=16` 提交一个 LTE 的 EARFCN。新前端应自动带上正确的 rat。
- 静态提示文案（`index.html:376-381`、`zh.json:105-106`）：「⚠️ 注意，选错基站可能会导致信号不稳定/无信号等问题」「提示：暂停刷新后可以依次锁定多个基站」。后一句说明可以锁定多个小区，与 `locked_cell_info` 是数组相符。

### 6.4 刷新机制

- 区块展开时（`localStorage.collapse_lkcell` 默认 `'open'`）开始 `requestInterval(initCellInfo, REFRESH_TIME + 1500)`，默认 2500 ms；折叠时停止（`main.js:1892-1906`、`main.js:4193-4203`）。区块内的「停止刷新 / 开始刷新」按钮也能切换（`main.js:1908-1918`）。
- 「当前基站」行跟随主页轮询（`REFRESH_TIME`）刷新，与邻区表不同步。

---

## 7. 流量与网速

### 7.1 实时网速

- 字段：`realtime_rx_thrpt`（下行）、`realtime_tx_thrpt`（上行）。
- 【代码】按**字节 / 秒**处理：
  - 主页：`formatBytes(Number(x)) + "/S"`（`main.js:1036`）。
  - 网速图：数据点为 `value / 1024`（KB/s），y 轴 `suggestedMax: 38400`（约 37.5 MB/s，约 300 Mbps）；中心文字 `↑ formatBytes(tx)/S ↓ formatBytes(rx)/S`（`charts.js:431-470`）。
  - 图表在 `UFI_DATA.realtime_rx_thrpt` 被赋值时触发，上行值从 `window.UFI_DATA.realtime_tx_thrpt` 读取（`charts.js:7-9`、`charts.js:434`）。
- 【截图A/B】「⬇️ 1.01 KB/S ⬆️ 1.95 KB/S」，网速卡片「↑ 3.27 KB/S ↓ 2.37 KB/S」。
- 【推断】固件单位确实是 B/s（数量级与截图一致）。新前端如需显示 Mbps，换算为 `× 8 / 1e6`。

### 7.2 流量统计（两套来源）

| 显示 | 字段 | 来源 | 单位 | 出处 |
| --- | --- | --- | --- | --- |
| 已用流量 | `monthly_tx_bytes + monthly_rx_bytes` | goform（官方后台统计） | B | `main.js:1028` |
| 总流量 | `data_volume_limit_size` | goform | 见 7.3 | `main.js:1028-1032` |
| 连接时长 / 总时长 | `realtime_time` / `monthly_time` | goform | 秒 | `main.js:1027` |
| 当日流量 / 本月已用 | `daily_data` / `monthly_data` | `/api/baseDeviceInfo`（Android 系统流量统计） | B | `main.js:1033` |

- 【截图C】标注：「已用流量 / 总流量」来自官方后台，「当日流量 / 本月已用」来自 Android 自带统计（更准确）。同一屏两者分别为 51.76 GB 和 51.25 GB。
- 坑：主页先把 `res.monthly_tx_bytes + res.monthly_rx_bytes` 相加，再整体 `Number()`（`main.js:1028`）。如果两者都是字符串，会变成字符串拼接。截图显示的是合理的 51.74 GB，所以【推断】真机上这两个字段是 **JSON number**（至少不会同时是字符串）。流量管理弹窗里则是分别 `Number()` 后再相加（`main.js:2191`）。新前端一律先转数字再计算。
- 【截图A】「总时长 2607.6 小时」（约 108 天）。【推断】`monthly_time` 并非严格按自然月统计，可能是自上次清零以来的累计。

### 7.3 官方流量限额 `data_volume_limit_*`【代码】

**主页读取与显示**

- 主页只用 cmd 里的 `data_volume_limit_switch` 和 `data_volume_limit_size`。代码同时兼容 `flux_` 前缀版本，但主页 cmd 没请求它们，正常情况下不存在。
- 「/ 总流量」的显示条件：`(data_volume_limit_size || flux_data_volume_limit_size) && (flux_data_volume_limit_switch == '1' || data_volume_limit_switch == '1')`（`main.js:1028`）。
- 总流量字节数 = `size.split('_')[0] × size.split('_')[1] × 1024²`（`main.js:1029-1031`）。
- `data_volume_alert_percent` 在主页**没有任何显示**。表单提示里说达到阈值时设备红灯闪烁（`zh.json:804`）。

**「流量管理」弹窗读取**

- `getDataUsage()`（`requests.js:512-522`）的 cmd：
  `flux_data_volume_limit_switch,data_volume_limit_switch,data_volume_limit_unit,data_volume_limit_size,data_volume_alert_percent,monthly_tx_bytes,monthly_rx_bytes,monthly_time,wan_auto_clear_flow_data_switch,traffic_clear_date,`（末尾多了一个逗号）。
- 每个非 `flux_` 字段为 `null` / `undefined` 时，回退到对应的 `flux_` 字段（`main.js:2165-2173`；函数名 `isNullOrUndefiend` 实际含义是"非空"）。

| 字段 | 格式 | 示例 | 原版解析 | 出处 |
| --- | --- | --- | --- | --- |
| `data_volume_limit_switch` | `"0"` / `"1"` | `"1"` | `.toString() == '1'`（值为 undefined 时会抛异常） | `main.js:2204` |
| `data_volume_limit_size` | `"<数值>_<倍数>"`，倍数以 MB 计：`1` = MB，`1024` = GB，`1048576` = TB | `"800_1024"` = 800 GB | `split('_')` | `main.js:2209-2214`、`index.html:767-773` |
| `data_volume_alert_percent` | `"0"`–`"100"` | `"80"` | 原样回填；提交时校验 0–100 | `main.js:2208`、`main.js:2282-2293` |
| `data_volume_limit_unit` | `"data"` / `"time"` | `"data"` | `== 'data'`；原版表单只有"流量"一个选项 | `main.js:2206` |
| `traffic_clear_date` | `"1"`–`"31"` | `"1"` | 回填；提交时校验 0–31（提示文案写 1–31） | `main.js:2207`、`main.js:2270-2281` |
| `wan_auto_clear_flow_data_switch` | `"on"` / `"0"`（关闭写 `'0'` 而不是 `'off'`） | `"on"` | `== 'on'` | `main.js:2205`、`main.js:2262-2265` |
| `monthly_tx_bytes` / `monthly_rx_bytes` | 字节 | — | 已用 = (rx + tx) / 1024² MB，再自动选 MB / GB / TB | `main.js:2189-2202` |

**写入**（`main.js:2226-2367`）

1. `goformId=DATA_LIMIT_SETTING`。开关打开时提交：`data_volume_limit_switch`、`wan_auto_clear_flow_data_switch`、`data_volume_limit_unit`、`traffic_clear_date`、`data_volume_alert_percent`、`data_volume_limit_size="<n>_<倍数>"`、`data_volume_used_size`、`data_volume_used_type`、`notify_deviceui_enable="0"`，以及对应的 `flux_*` 副本（`flux_clear_date`、`flux_data_volume_limit_type="_<倍数>"` 等）。开关关闭时只提交一组固定的清理字段（`main.js:2329-2338`）。
2. 紧接着 `goformId=FLOW_CALIBRATION_MANUAL`，参数 `calibration_way=<data_volume_limit_unit>`、`time=0`、`data=<已用字节整数>`（已用字节 = 数值 × 倍数 × 1024²）。
3. 两个都返回 success 才算成功。

### 7.4 UFI 自身流量阈值

- `GET /api/get_data_limit` 返回 `{ data_flow_limit_enabled: "1", data_flow_max_limit: <字节, number>, data_flow_check_daily_or_monthly: "monthly" | "daily", data_check_reference: "android" | "default", data_limit_status_forward_enabled: "1" | "0" }`（`main.js:8208-8257`，`API_Doc.md` §3.2）。
- 回填：字节数能被 1024⁴ 整除显示为 TB，能被 1024³ 整除显示为 GB，否则按 MB 向下取整（`main.js:8225-8239`）。
- 提交时 `data_flow_max_limit = 数值 × 倍数 × 1024²`，用 `toFixed(3)` 转成字符串（`main.js:8300`）。
- 达到阈值后后端把 `/api/baseDeviceInfo` 的 `is_reached_data_flow_limit` 置为 true 并断网，前端 toast 一次。

---

## 8. 危险操作与二次确认

原版所有"确认"都是"同一个按钮连点 + 修改按钮文字"，没有弹窗，也没有用 `window.confirm`。

| 操作 | 原版确认方式 | 文案（`zh.json`） | 接口 | 出处 |
| --- | --- | --- | --- | --- |
| 重启设备 | 3 击确认：3 s 内连点，按钮文字「重启设备」→「再点二次」→「再点一次」→「正在重启」，第 3 击执行；3 s 无操作复位 | `reboot` / `reboot_confirm` / `reboot_confirm_confirm` / `rebooting`（`zh.json:8-11`）；「重启成功！」/「重启失败，请检查网络」（`zh.json:495-496`） | `REBOOT_DEVICE` | `main.js:2010-2064` |
| 关闭电源 | 连点确认：「关闭电源」→「再点一次」→「正在关机」。首次 2 击执行，复位后要 3 击（计数复位值写成了 0）；只在有电池时显示 | `shutdown` / `confirm_shutdown` / `shutting_down`（`zh.json:13-15`）；「关机成功！」/「关机失败！」（`zh.json:520-521`） | `SHUTDOWN_DEVICE` | `main.js:3048-3109` |
| 切换选网（包括仅 5G SA） | **无确认**，下拉即提交 | 「更改中，请稍后」→「操作成功」/「操作失败」 | `SET_BEARER_PREFERENCE` | `main.js:1352-1378` |
| 锁频段 / 解除锁频段 | **无确认**；按钮 loading；成功后自动 SFUN 关开协议栈（会断网数秒，没有提示） | 「设置频段成功！」/「设置频段失败!」（`zh.json:487-488`） | `LTE_BAND_LOCK`、`NR_BAND_LOCK`、`/api/AT` | `main.js:1737-1836` |
| 锁基站 | **无确认**；只有区块顶部的静态警告 | 「⚠️ 注意，选错基站可能会导致信号不稳定/无信号等问题」「提示：暂停刷新后可以依次锁定多个基站」；「请填写完整数据」；「设置基站成功！」/「设置基站失败!」（`zh.json:105-106`、`zh.json:490-492`） | `CELL_LOCK` | `index.html:376-381`、`main.js:1931-1979` |
| 解除锁定基站 | **无确认** | 「解锁基站成功！」/「解锁基站失败!」（`zh.json:493-494`） | `UNLOCK_ALL_CELL` | `main.js:1981-2008` |
| 数据开关（断网 / 联网） | **无确认**；按钮文字变为「正在更改」 | 「操作成功」/「操作失败」 | `CONNECT_NETWORK` / `DISCONNECT_NETWORK` | `main.js:2761-2801` |
| 重启基带（`AT+CFUN=1,1`）、自定义 AT、高铁模式 | **无确认**；AT 弹窗顶部有静态警告 | `at_warning_1`：「⚠️警告：执行自定义AT属于高级操作，请务必确保输入准确无误。因执行指令所引发的任何后果，需由您自行承担。」（`zh.json:296`）；高铁模式成功「操作成功！重启生效」（`zh.json:478`） | `/api/AT` | `index.html:1559-1565`、`index.html:1609-1610`、`main.js:7219-7244` |
| 重置字段显示 | 2 击：「重置(全选)」→「确认?」 | `btn_confirm_question`（`zh.json:426`） | localStorage | `main.js:2102-2120` |

新前端按 `CLAUDE.md` 改用 Modal 确认时，下面这些原版没有确认、但会导致断网或掉线的操作建议补上确认：切到 `Only_5G` / `Only_LTE` / `Only_WCDMA`、锁频（含 SFUN 重启协议栈）、锁基站、断开数据、重启基带。

---

## 附录 A：原版已知的坑（新前端不要照搬）

1. **`REFRESH_TIME` 被改成字符串**：`changeRefreshRate` 把下拉的字符串值直接赋给 `REFRESH_TIME`（`main.js:5309`），之后 `REFRESH_TIME + 1500`（`main.js:1897`）变成字符串拼接，例如 `"10001500"`（约 2.8 小时），锁基站列表实际上不再自动刷新。
2. **`fetchWithTimeout` 覆盖了请求头**：`headers: { ...common_headers }`（`requests.js:493`）把 `getData` / `postData` 自己传入的 `Content-Type`、`Cookie` 都丢掉了，只有主页轮询（直接用 `fetch`）带了 `kano-cookie`。后端只把 `Kano-Cookie` 请求头转成上游 Cookie（`reverseProxyModule.kt:58-84`）。【推断】固件的写操作会话可能按来源（本机代理）识别。新前端应在所有 goform 请求上统一携带 `Kano-Cookie`。
3. **部分读取没带 `multi_data=1`**：`neighbor_cell_info,locked_cell_info`、`lte_band_lock,nr_band_lock`、`battery_value,battery_vol_percent` 都没带，仍能拿到多个字段（推断固件对此宽容）。新前端统一带上。
4. **`requestInterval` 基于 rAF**：后台标签页会停止轮询；也没有防重入，慢网时请求会叠加。
5. **流量相加顺序**：`monthly_tx_bytes + monthly_rx_bytes` 先相加再转数字（见 7.2）。
6. **`formatBytes` 只认 number 0**（见 1.6）。
7. **toast 参数错位**：`createToast(t("data_flow_limit_reached", "pink", 8000))`（`main.js:899`），颜色和时长被传进了 `t()`。
8. **当前小区行的 onclick 插值**：PCI / FCN 为空时生成 `onSelectCellRow(,)`，是语法错误（`main.js:990`）。
9. **`"null"` 字符串**：Kotlin 字符串插值导致 `app_ver` / `model` / `battery` / `client_ip` 采集失败时是字符串 `"null"`。
10. **NR 频段缓存不区分 slot**（见 5.1）。
11. **`cpuFreqInfo` 必须从 `cpu0` 连续编号**（见 1.5.3）。

---

## 附录 B：TypeScript 类型草案

```ts
/** goform 返回值：真机多为字符串，部分计数器推断为 number；"" 表示无值 */
export type NumLike = string | number;

/** 主页轮询：GET goform_get_cmd_process?multi_data=1&cmd=<39 个字段> */
export interface GoformStatus {
  usb_port_switch: '0' | '1' | string;
  battery_charging: '0' | '1' | '';
  sms_received_flag: string;            // 原版未使用
  sms_unread_num: NumLike;
  sms_sim_unread_num: NumLike;          // 原版未使用
  sim_msisdn: string;
  dual_sim_support: '0' | '1' | string;
  sim_slot: '0' | '1' | '2' | '11' | '12' | string;
  data_volume_limit_switch: '0' | '1' | string;
  battery_value: NumLike;               // %，可能为 ""
  battery_vol_percent: NumLike;         // %，可能为 ""
  network_signalbar: NumLike;           // 0–5 格
  network_rssi: NumLike;                // 原版未使用，含义未知
  cr_version: string;                   // 截图："U30Air_SSV1.0.0B14"
  iccid: string;
  imei: string;
  imsi: string;
  ipv6_wan_ipaddr: string;
  lan_ipaddr: string;
  mac_address: string;
  msisdn: string;
  network_information?: unknown;        // 推断为复合 cmd，原版不读本键
  Lte_ca_status?: string;               // 原版不读
  rssi: NumLike;                        // 0–5 格，不是 dBm
  Z5g_rsrp: NumLike;                    // dBm；"" 表示没有 5G
  lte_rsrp: NumLike;                    // dBm；"" 表示没有 4G
  wifi_access_sta_num: NumLike;
  loginfo: 'ok' | string;
  data_volume_alert_percent: NumLike;   // 0–100
  data_volume_limit_size: string;       // "<n>_<1|1024|1048576>"，MB × 倍数
  realtime_rx_thrpt: NumLike;           // B/s
  realtime_tx_thrpt: NumLike;           // B/s
  realtime_time: NumLike;               // 秒
  monthly_tx_bytes: NumLike;            // B，推断为 number
  monthly_rx_bytes: NumLike;            // B，推断为 number
  monthly_time: NumLike;                // 秒
  network_type: string;                 // "LTE"（截图）| "20" | "13"（代码分支）| 其它（推断）
  network_provider: string;             // "中国联通"（截图）
  ppp_status: string;                   // 'ppp_disconnected' | 其它视为已连接

  // —— 推断：由 network_information 展开并平铺在顶层，键名大小写原样保留 ——
  Nr_snr?: NumLike;  nr_rsrq?: NumLike;  nr_rssi?: NumLike;
  Nr_bands?: NumLike; Nr_fcn?: NumLike;  Nr_bands_widths?: NumLike;   // 带宽推断为 kHz
  Nr_pci?: NumLike;  Nr_cell_id?: NumLike;
  Lte_snr?: NumLike; lte_rsrq?: NumLike; lte_rssi?: NumLike;
  Lte_bands?: NumLike; Lte_fcn?: NumLike; Lte_bands_widths?: NumLike; // 截图 "10000" = 10 MHz
  Lte_pci?: NumLike; Lte_cell_id?: NumLike;
}

export interface CpuFreqCore { cur: number; max: number }          // MHz
export interface MemInfo {
  mem_total_kb: number; mem_available_kb: number; mem_used_kb: number;
  mem_usage_percent: string;                                        // 例 "59.7"
  swap_total_kb: number; swap_free_kb: number; swap_used_kb: number;
  swap_usage_percent: string;
}
export interface ThermalZone { type: string; temp: number }         // temp 为 m℃

/** GET /api/baseDeviceInfo */
export interface BaseDeviceInfo {
  app_ver: string; app_ver_code: string; model: string;            // 失败时为字符串 "null"
  battery: string;                                                  // "81"
  daily_data: number | null; monthly_data: number | null;           // B
  internal_available_storage: number | null;
  internal_used_storage: number | null;
  internal_total_storage: number | null;
  external_total_storage: number | null;                            // 无 SD 卡为 0
  external_used_storage: number | null;
  external_available_storage: number | null;
  cpu_temp_list: ThermalZone[] | null;                              // 嵌入数组，不是字符串
  cpu_temp: number | null;                                          // m℃；无传感器 -1
  client_ip: string;
  cpu_usage: number | null;                                         // %
  mem_usage: number | null;                                         // %
  cpuFreqInfo: Record<`cpu${number}`, CpuFreqCore> | null;          // 嵌入对象
  cpuUsageInfo: Record<string, string> | null;                      // { cpu: "1.4", cpu0: "2.0", ... }
  memInfo: MemInfo | null;
  current_now: number | null;                                       // µA；读取失败 -1
  voltage_now: number | null;                                       // µV；读取失败 -1
  is_reached_data_flow_limit: boolean;
  boot_time: number;                                                // ms，开机时长
}

export interface NeighborCell {
  band: NumLike; earfcn: NumLike; pci: NumLike;
  rsrp: NumLike; rsrq: NumLike; sinr: NumLike;
}
export interface LockedCell { earfcn: NumLike; pci: NumLike; rat: '12' | '16' | NumLike } // 12 = 4G，16 = 5G
export interface CellInfoResponse {
  neighbor_cell_info: NeighborCell[] | '';
  locked_cell_info: LockedCell[] | '';
}
export interface BandLockResponse { lte_band_lock: string; nr_band_lock: string }   // 例 "1,3,41"
export interface NrBandListResponse { slot: number; band_list: number[] }
export interface NetSelectResponse { net_select: BearerPreference | string }
export type BearerPreference =
  | 'WL_AND_5G' | 'LTE_AND_5G' | 'Only_5G' | 'WCDMA_AND_LTE' | 'Only_LTE' | 'Only_WCDMA';
export interface AtResponse { result?: string; error?: string }
export interface GoformWriteResult { result: 'success' | string }
```

---

## 附录 C：Mock 示例 JSON

说明：

- 格式依据前文各节。截图实证的格式尽量照搬；EARFCN / NR-ARFCN / PCI / 信号值按频段范围与常见组合构造，**不是真机采集**。
- 标识类字段（IMEI / ICCID / IMSI / MAC / 手机号）均为明显的占位值。
- 设备型号与版本号沿用截图A 中的 U30 Air。F50 的 `model` 值在代码里没有出现，需真机确认。
- goform 值除 `monthly_*_bytes` 外都用字符串（推断）。建议另外准备一套"全字符串"变体，测试解析层的健壮性。

### C.1 主页轮询 goform 响应：中国移动 5G SA，驻留 n41

16 个展开信号字段平铺在顶层，未驻留的 4G 组为 `""`。`network_type` 取代码中唯一有证据的 5G 值 `"20"`；如需覆盖推断的名称字符串格式，见 C.2 的 `cmcc_sa_n41_named`。

```json
{
  "usb_port_switch": "0",
  "battery_charging": "1",
  "sms_received_flag": "0",
  "sms_unread_num": "2",
  "sms_sim_unread_num": "0",
  "sim_msisdn": "",
  "dual_sim_support": "0",
  "sim_slot": "0",
  "data_volume_limit_switch": "1",
  "battery_value": "76",
  "battery_vol_percent": "76",
  "network_signalbar": "4",
  "network_rssi": "",
  "cr_version": "U30Air_SSV1.0.0B14",
  "iccid": "89860000000000000000",
  "imei": "860000000000000",
  "imsi": "460000000000000",
  "ipv6_wan_ipaddr": "2409:8a00:0:0:0:0:0:1",
  "lan_ipaddr": "192.168.0.1",
  "mac_address": "02:00:00:00:00:01",
  "msisdn": "",
  "network_information": "",
  "Lte_ca_status": "",
  "rssi": "4",
  "Z5g_rsrp": "-88",
  "lte_rsrp": "",
  "wifi_access_sta_num": "3",
  "loginfo": "ok",
  "data_volume_alert_percent": "80",
  "data_volume_limit_size": "200_1024",
  "realtime_rx_thrpt": "3355443",
  "realtime_tx_thrpt": "524288",
  "realtime_time": "99000",
  "monthly_tx_bytes": 5368709120,
  "monthly_rx_bytes": 50465865728,
  "monthly_time": "1296000",
  "network_type": "20",
  "network_provider": "中国移动",
  "ppp_status": "ppp_connected",
  "Nr_snr": "14",
  "nr_rsrq": "-11",
  "nr_rssi": "-53",
  "Nr_bands": "41",
  "Nr_fcn": "504990",
  "Nr_bands_widths": "100000",
  "Nr_pci": "113",
  "Nr_cell_id": "5056786433",
  "Lte_snr": "",
  "lte_rsrq": "",
  "lte_rssi": "",
  "Lte_bands": "",
  "Lte_fcn": "",
  "Lte_bands_widths": "",
  "Lte_pci": "",
  "Lte_cell_id": ""
}
```

原版合并后，前端对象还会多出（或覆盖）这些键：C.3 的全部字段、`battery: "76"`（取自 `battery_value`）、`QORS_MESSAGE: "QCI：9 ⬇️ 1000Mbps ⬆️ 200Mbps"`（来自 C.8）。这些是前端生成的，Mock 后端不需要返回。

### C.2 场景变体（在 C.1 基础上覆盖的键）

`cmcc_sa_n41_named` 用于测试推断的名称格式；`cucc_lte_b8_screenshot` 的信号值取自截图A/H；`ctcc_nsa_n78_b3` 的 `network_type` 与"两组同时有值"均为推断；`ctcc_lte_b1` 演示纯 4G；`data_disconnected` 演示数据断开；`session_expired` 会触发原版的自动重登录。

```json
{
  "cmcc_sa_n41_named": {
    "network_type": "SA"
  },
  "cmcc_sa_n28": {
    "Z5g_rsrp": "-84",
    "Nr_snr": "9",
    "nr_rsrq": "-12",
    "nr_rssi": "-51",
    "Nr_bands": "28",
    "Nr_fcn": "154810",
    "Nr_bands_widths": "30000",
    "Nr_pci": "502",
    "Nr_cell_id": "5056790529",
    "rssi": "5",
    "network_signalbar": "5"
  },
  "ctcc_sa_n78": {
    "network_provider": "中国电信",
    "imsi": "460110000000000",
    "Z5g_rsrp": "-95",
    "Nr_snr": "11",
    "nr_rsrq": "-12",
    "nr_rssi": "-60",
    "Nr_bands": "78",
    "Nr_fcn": "627264",
    "Nr_bands_widths": "100000",
    "Nr_pci": "528",
    "Nr_cell_id": "1876123649",
    "rssi": "3",
    "network_signalbar": "3"
  },
  "ctcc_nsa_n78_b3": {
    "network_type": "13",
    "network_provider": "中国电信",
    "imsi": "460110000000000",
    "Z5g_rsrp": "-95",
    "Nr_snr": "11",
    "nr_rsrq": "-12",
    "nr_rssi": "-60",
    "Nr_bands": "78",
    "Nr_fcn": "627264",
    "Nr_bands_widths": "100000",
    "Nr_pci": "528",
    "Nr_cell_id": "",
    "lte_rsrp": "-92",
    "Lte_snr": "9",
    "lte_rsrq": "-11",
    "lte_rssi": "-61",
    "Lte_bands": "3",
    "Lte_fcn": "1825",
    "Lte_bands_widths": "20000",
    "Lte_pci": "291",
    "Lte_cell_id": "35121921"
  },
  "cucc_lte_b8_screenshot": {
    "network_type": "LTE",
    "network_provider": "中国联通",
    "imsi": "460010000000000",
    "rssi": "5",
    "network_signalbar": "5",
    "data_volume_limit_size": "800_1024",
    "Z5g_rsrp": "",
    "Nr_snr": "",
    "nr_rsrq": "",
    "nr_rssi": "",
    "Nr_bands": "",
    "Nr_fcn": "",
    "Nr_bands_widths": "",
    "Nr_pci": "",
    "Nr_cell_id": "",
    "lte_rsrp": "-85",
    "Lte_snr": "4",
    "lte_rsrq": "-10",
    "lte_rssi": "-59",
    "Lte_bands": "8",
    "Lte_fcn": "3740",
    "Lte_bands_widths": "10000",
    "Lte_pci": "143",
    "Lte_cell_id": "35121921"
  },
  "ctcc_lte_b1": {
    "network_type": "LTE",
    "network_provider": "中国电信",
    "imsi": "460110000000000",
    "Z5g_rsrp": "",
    "Nr_snr": "",
    "nr_rsrq": "",
    "nr_rssi": "",
    "Nr_bands": "",
    "Nr_fcn": "",
    "Nr_bands_widths": "",
    "Nr_pci": "",
    "Nr_cell_id": "",
    "lte_rsrp": "-97",
    "Lte_snr": "6",
    "lte_rsrq": "-12",
    "lte_rssi": "-66",
    "Lte_bands": "1",
    "Lte_fcn": "100",
    "Lte_bands_widths": "20000",
    "Lte_pci": "291",
    "Lte_cell_id": "35121922"
  },
  "data_disconnected": {
    "ppp_status": "ppp_disconnected",
    "realtime_rx_thrpt": "0",
    "realtime_tx_thrpt": "0",
    "realtime_time": "0"
  },
  "session_expired": {
    "loginfo": ""
  }
}
```

频点换算（用于核对 Mock 合理性）：

- NR，3 GHz 以下：`F = 0.005 × N` MHz，504990 → 2524.95（n41），154810 → 774.05（n28）。
- NR，3 GHz 以上：`F = 3000 + 0.015 × (N − 600000)`，627264 → 3408.96（n78）。
- LTE B1：`2110 + 0.1 × N`，100 → 2120。B3：`1805 + 0.1 × (N − 1200)`，1825 → 1867.5。B8：`925 + 0.1 × (N − 3450)`，3740 → 954。

### C.3 `GET /api/baseDeviceInfo`

数值按截图A–E 的量级反推。`-thmzone` 后缀为推断；当前后端已过滤 chg / interface 等 zone，所以这里不包含。`cpuUsageInfo` 故意缺 `cpu7`，用来演示"离线核心频率显示 0"（截图B）。

```json
{
  "app_ver": "4.1.3",
  "app_ver_code": "20260908",
  "model": "U30 Air",
  "battery": "76",
  "daily_data": 267774853,
  "monthly_data": 55029268480,
  "internal_available_storage": 19166291558,
  "internal_used_storage": 5819680686,
  "internal_total_storage": 24985972244,
  "external_total_storage": 0,
  "external_used_storage": 0,
  "external_available_storage": 0,
  "cpu_temp_list": [
    { "type": "ai0-thmzone", "temp": 38890 },
    { "type": "ai1-thmzone", "temp": 38650 },
    { "type": "apcpu0-thmzone", "temp": 39930 },
    { "type": "apcpu1-thmzone", "temp": 39930 },
    { "type": "big7-thmzone", "temp": 38830 },
    { "type": "board-thmzone", "temp": 39660 },
    { "type": "gpu-thmzone", "temp": 39710 },
    { "type": "lit0-thmzone", "temp": 39930 },
    { "type": "lte-thmzone", "temp": 38890 },
    { "type": "mm-thmzone", "temp": 38890 },
    { "type": "nr0-thmzone", "temp": 38650 },
    { "type": "nr1-thmzone", "temp": 38170 },
    { "type": "pa-thmzone", "temp": 38080 },
    { "type": "soc-thmzone", "temp": 39930 }
  ],
  "cpu_temp": 39930,
  "client_ip": "192.168.0.253",
  "cpu_usage": 1.4,
  "mem_usage": 59.7,
  "cpuFreqInfo": {
    "cpu0": { "cur": 2002, "max": 2002 },
    "cpu1": { "cur": 2002, "max": 2002 },
    "cpu2": { "cur": 2002, "max": 2002 },
    "cpu3": { "cur": 2002, "max": 2002 },
    "cpu4": { "cur": 768, "max": 2002 },
    "cpu5": { "cur": 768, "max": 2002 },
    "cpu6": { "cur": 768, "max": 2002 },
    "cpu7": { "cur": 768, "max": 2002 }
  },
  "cpuUsageInfo": {
    "cpu": "1.4",
    "cpu0": "2.0",
    "cpu1": "1.0",
    "cpu2": "0.0",
    "cpu3": "3.1",
    "cpu4": "0.0",
    "cpu5": "1.0",
    "cpu6": "2.0"
  },
  "memInfo": {
    "mem_total_kb": 1502956,
    "mem_available_kb": 606249,
    "mem_used_kb": 896707,
    "mem_usage_percent": "59.7",
    "swap_total_kb": 931830,
    "swap_free_kb": 357059,
    "swap_used_kb": 574771,
    "swap_usage_percent": "61.7"
  },
  "current_now": 3000,
  "voltage_now": 3936000,
  "is_reached_data_flow_limit": false,
  "boot_time": 275112000
}
```

`cpu_temp_list[].temp` 的 max 必须等于 `cpu_temp`。放电场景可把 `battery_charging` 改为 `"0"`、`current_now` 改为 `-350000`（`API_Doc.md` 的示例值；正负含义为推断）。

### C.4 `cmd=neighbor_cell_info,locked_cell_info`

中国移动 SA 场景，未锁定：

```json
{
  "neighbor_cell_info": [
    { "band": "41", "earfcn": "504990", "pci": "367", "rsrp": "-96", "rsrq": "-13", "sinr": "6" },
    { "band": "41", "earfcn": "504990", "pci": "742", "rsrp": "-104", "rsrq": "-17", "sinr": "-3" },
    { "band": "41", "earfcn": "528696", "pci": "113", "rsrp": "-99", "rsrq": "-14", "sinr": "2" },
    { "band": "28", "earfcn": "154810", "pci": "502", "rsrp": "-91", "rsrq": "-12", "sinr": "9" },
    { "band": "28", "earfcn": "154810", "pci": "85", "rsrp": "-100", "rsrq": "-15", "sinr": "1" }
  ],
  "locked_cell_info": []
}
```

已锁定（一个 5G 小区 + 一个 4G 小区，rat 分别为 `"16"` / `"12"`），4G 邻区（电信 B3 / B1 / B5）：

```json
{
  "neighbor_cell_info": [
    { "band": "3", "earfcn": "1825", "pci": "17", "rsrp": "-101", "rsrq": "-15", "sinr": "0" },
    { "band": "3", "earfcn": "1825", "pci": "380", "rsrp": "-97", "rsrq": "-12", "sinr": "4" },
    { "band": "1", "earfcn": "100", "pci": "291", "rsrp": "-95", "rsrq": "-11", "sinr": "7" },
    { "band": "5", "earfcn": "2452", "pci": "291", "rsrp": "-89", "rsrq": "-10", "sinr": "11" }
  ],
  "locked_cell_info": [
    { "earfcn": "504990", "pci": "113", "rat": "16" },
    { "earfcn": "1825", "pci": "291", "rat": "12" }
  ]
}
```

空态（截图H 中 4G 驻留时为此状态）：

```json
{ "neighbor_cell_info": [], "locked_cell_info": [] }
```

### C.5 `cmd=lte_band_lock,nr_band_lock`

未锁频（推断返回全集，`nr_band_lock` 应与 C.6 的 `band_list` 一致）：

```json
{ "lte_band_lock": "1,3,5,8,34,38,39,40,41", "nr_band_lock": "1,3,5,8,28,41,78,79" }
```

已锁频示例：

```json
{ "lte_band_lock": "3,39,40,41", "nr_band_lock": "28,41" }
```

### C.6 `GET /api/getSupportNrBandList?slot=0`

成功（频段组合为推断）：

```json
{ "slot": 0, "band_list": [1, 3, 5, 8, 28, 41, 78, 79] }
```

失败（HTTP 500，原版此时回退为 `[1,5,8,28,41,78]`）：

```json
{ "error": "getSupportNrBandList 错误：查询 NR 支持频段失败：ERROR" }
```

### C.7 `cmd=net_select`

```json
{ "net_select": "WL_AND_5G" }
```

Mock 层需保持读写一致：`SET_BEARER_PREFERENCE` 成功后，`net_select` 返回新值。

### C.8 `GET /api/AT`

`command=AT+CGEQOSRDP=1`，原版解析为 `QCI：9 ⬇️ 1000Mbps ⬆️ 200Mbps`：

```json
{ "result": "+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK" }
```

`command=AT+SFUN=5` / `AT+SFUN=4`：按后端规范化逻辑，纯 `OK` 输出会变成 `" OK"`（开头带空格，推断）：

```json
{ "result": " OK" }
```

执行失败（HTTP 500）：

```json
{ "error": "AT指令执行错误：AT 指令没有输出" }
```

### C.9 流量管理 `getDataUsage()`

```json
{
  "flux_data_volume_limit_switch": "1",
  "data_volume_limit_switch": "1",
  "data_volume_limit_unit": "data",
  "data_volume_limit_size": "200_1024",
  "data_volume_alert_percent": "80",
  "monthly_tx_bytes": 5368709120,
  "monthly_rx_bytes": 50465865728,
  "monthly_time": "1296000",
  "wan_auto_clear_flow_data_switch": "on",
  "traffic_clear_date": "1"
}
```

`GET /api/get_data_limit`：

```json
{
  "data_flow_limit_enabled": "1",
  "data_flow_max_limit": 214748364800,
  "data_flow_check_daily_or_monthly": "monthly",
  "data_check_reference": "android",
  "data_limit_status_forward_enabled": "0"
}
```

### C.10 goform 写操作通用响应

`SET_BEARER_PREFERENCE`、`LTE_BAND_LOCK`、`NR_BAND_LOCK`、`CELL_LOCK`、`UNLOCK_ALL_CELL`、`CONNECT_NETWORK`、`DISCONNECT_NETWORK`、`REBOOT_DEVICE`、`DATA_LIMIT_SETTING`、`FLOW_CALIBRATION_MANUAL` 成功时都返回：

```json
{ "result": "success" }
```

原版只认 `result == 'success'`，其它一律当失败。失败时的具体值是推断（登录失败为 `"3"`，见 `API_Doc.md:752`）：

```json
{ "result": "failure" }
```

---

## 附录 D：最容易踩坑的字段格式

1. **`rssi` 是 0–5 格数，不是 dBm**。dBm 在 `lte_rssi` / `nr_rssi`，RSRP 在 `lte_rsrp` / `Z5g_rsrp`（5G 前缀是 `Z5g_`）。
2. **16 个 4G/5G 详细信号键**（`Nr_snr`、`Lte_pci`、`Nr_fcn`、`Nr_bands_widths` 等）不在 cmd 列表里，推断由 `network_information` 展开、平铺在响应顶层。键名大小写混用，要逐字保留；未驻留的制式为 `""`；带宽推断为 kHz（`10000` = 10 MHz）。
3. **`network_type` 格式不统一**：截图是 `"LTE"`，代码分支是 `"20"` / `"13"`；原版不区分 SA / NSA，需要按"哪组字段非空"自行判断。
4. **`/api/baseDeviceInfo` 的单位与类型**：`cpu_temp` 和 `cpu_temp_list[].temp` 是毫摄氏度；`cpuFreqInfo` / `cpuUsageInfo` / `memInfo` / `cpu_temp_list` 是嵌入 JSON 而不是字符串，但其中的使用率、百分比值又是字符串；`current_now` 为 µA、`voltage_now` 为 µV；`boot_time` 是开机时长（ms），不是时间戳。
5. **频段锁与锁小区**：`lte_band_lock` / `nr_band_lock` 是无前缀的逗号串；原版的"解除锁频"是提交全集而不是空串，提交成功后会对两个槽位执行 `AT+SFUN=5` 再 `AT+SFUN=4`。锁小区的 `rat` 用 `"12"` 表示 4G、`"16"` 表示 5G，且原版点选邻区时不会自动带上 rat。
