# 交接：解决 iPad 显示不出 book_uid（RC522 读卡）问题

## 项目一句话
UCL CASA 毕设「全息虚拟图书管理员」。MKR WiFi 1010 接三个传感器，自建 Wi-Fi 热点，
iPad 轮询 `http://192.168.4.1/sensors` 拿 JSON 驱动界面。现场无 Mac。

## 部署架构
[VL53L0X + BME280 + RC522] → MKR WiFi 1010（HTTP :80, AP 模式）←Wi-Fi→ iPad
- AP SSID：`VirtualLibrarian`，密码：`casa2026`，板子 IP：`192.168.4.1`
- 固件：`arduino/library_sensors/library_sensors.ino`（`USE_AP 1`）
- 编译/烧录：macOS + arduino-cli，FQBN `arduino:samd:mkrwifi1010`

## 当前可用状态（已验证）
- AP、HTTP、`/sensors` 正常返回 JSON。
- VL53L0X（测距）`tof:1` 正常；BME280（温湿度）`env:1` 正常。
- 典型 JSON：`{"distance_mm":30,"presence":1,"temp_c":32.8,"humidity_pct":49.4,
  "book_uid":"","book_present":0,"sensors":{"tof":1,"env":1,"rfid":0,"env_chip":"BME280"}...}`

## ⚠ 待解决的核心问题
**iPad 显示不出 book_uid，根因在 RC522 这一端，不在 iPad App。**
`/sensors` 里 `book_uid` 一直是空字符串 `""`，所以 iPad 当然显示不出来。
需要让 RC522 真正读到 NFC 标签的 UID，让 `book_uid` 填上值。

分两层卡点：
1. **RC522 检测时有时无**：曾到过 `rfid:1`（version 读得到），但在后续挪线/断电中又变回 `rfid:0`。
   `rfid:0` = 开机没识别到 RC522 = 接线松了（MISO→D10、3.3V、GND 最易松）。
   注意：RC522 **只在开机时检测一次**，重新接好后必须重启板子。
2. **即使 `rfid:1`，放卡也读不出 UID**：把标签贴到线圈上，`book_uid` 仍为空。这是真正没解决的问题。

## 已排除 / 已知
- 标签是好的：用手机 NFC Tools 能读出（ISO14443-4 / Type A / UID 53:4C:E9:18:95:00:01）。RC522 理论上能读这种 Type A 卡。
- 金属失谐已排除：把 RC522 悬空远离金属/iPad 测过，仍读不到。
- 已把天线增益拉到最大：`initRfid()` 里有 `rfid.PCD_SetAntennaGain(MFRC522::RxGain_max); rfid.PCD_AntennaOn();`
- 库版本：MFRC522 用 miguelbalboa 1.4.x（v1 API），VL53L0X 用 Pololu。

## 引脚（与固件一致，勿改）
- I²C：SDA=D11, SCL=D12（VL53L0X 0x29 + BME280 0x76 并联）
- RC522 SPI：SS=D5, RST=D4, MOSI=D8, SCK=D9, MISO=D10, 3V3, GND（IRQ 不接）

## 固件里现有的调试探针（重要）
- `#define RFID_DEBUG`（当前 = 0）：设为 1 重新编译后，loop 里每秒打印
  `[dbg] ver=0x.. tx=0x.. rfcfg=0x.. cardSeen=YES/no` —— **这是定位读卡问题的关键，但一直没拿到贴卡后的读数**。
- loop() 顶部有心跳 `[hb] ip=... stages: tof env rfid (loop alive)`，用于确认 loop 没卡死。
- 部署前这两段调试应删掉。

## 建议的下一步（继续解决 book_uid）
1. 先把 RC522 接线插实，重启板子，确认 `/sensors` 里 `rfid:1`。
2. 把 `RFID_DEBUG` 设为 1，重新编译烧录，开串口监视器（不用按 RESET，每秒自刷）。
3. 不放卡看几行、再贴卡看几行 `[dbg]`，看 `cardSeen`：
   - 贴卡变 `YES` 但 book_uid 仍空 → 问题在读 UID（防冲突/Select），改 `pollRfid()` 逻辑。
   - 贴卡仍 `no` → 天线没探测到卡，查供电/天线（甚至换模块）。
   - `tx=0x80`（低两位为 0）→ 天线没打开 = SPI 写入问题。
4. 一旦 `book_uid` 出现，把 UID 写进 `src/bookDb.js` 的 `BOOK_TAGS`（格式 `'UID大写':'书名'`，书名须是 MEDIA 里已有标题），再 `npm run ios:sync` 重装 iPad App。

## 关键踩坑经验（避免重复浪费时间）
- **串口端口名每次重插会变**（出现过 usbmodem11201 / usbmodem1101）。每次先 `arduino-cli board list` 查当前端口再用。
- **SAMD 一按 RESET 会断 USB**，串口监视器会 `Port closed`。要看开机日志就用上面的心跳探针（不用按 RESET）。
- **NINA WiFi 是独立协处理器**：按 RESET 和重新烧录都不重置它。出现「能连上 AP / ping 通、但 80 端口连不上（curl 超时）」时，是 NINA 的 socket 被 iOS 探测+失败连接耗尽了——**必须拔 USB 线彻底断电 ~20 秒**才能清掉，RESET/重烧无效。
- **不要让本地 AI 乱改库文件**：之前有人给 `Arduino_SpiNINA/spi_drv.cpp` 加了无用的 PINS_COUNT、又乱加 #define，导致编译失败。已用 `arduino-cli lib uninstall/install` 还原。编译失败时先 `grep -nE "error:|undefined reference"` 抓真实报错，别瞎猜。
- 不要碰 `src/pyramid.js` 和语音相关文件。

## 当前正在并行进行的事（与本问题无关，别混淆）
PCB 已交由嘉立创代画完成（VL53L0X/BME280 焊板上、RC522 外接 7 针、放板边不铺铜），
正在 jlcpcb.com 下单光板（不做 PCBA）。这条线不影响 book_uid 调试。
