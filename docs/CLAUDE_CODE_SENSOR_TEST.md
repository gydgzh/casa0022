# 传感器节点测试流程（v3 三传感器）

目标：验证 MKR WiFi 1010 上 VL53L0X + BME280 + RC522 三个传感器全部工作，
并完成台架测试。**只测试，不改代码逻辑，不碰 pyramid.js 和语音相关文件。**
固件已编译烧录成功，当前模式 `USE_AP=1`（自建热点）。

端口：`/dev/cu.usbmodem11201`　固件目录：`arduino/library_sensors`

每一步贴出命令输出再进行下一步；失败就停下报告，不要重写固件。

---

## 步骤 1 — 开机自检（确认三个传感器被识别）

```bash
arduino-cli monitor -p /dev/cu.usbmodem11201 -c baudrate=115200
```

连上后**按板子的 RESET 键**，读开机日志。期望：

```
[tof]  VL53L0X OK (0x29)
[env]  BME280 OK at 0x76          (或 BMP280)
[rfid] RC522 OK (version 0x92)    ← 关键，必须 OK
[boot] sensors: tof=1 env=1 rfid=1
```

判定：
- `rfid=1` → 继续步骤 2。
- `RC522 NOT FOUND (version reg 0x0)` → MISO 没接到脚 10 / 没供电 / 排针虚焊。**停下报告，这是接线问题，不要改代码。**
- `0xFF` → SPI 线接反。停下报告。

看完按 `Ctrl+C` 退出监视器（监视器占用串口时其它命令连不上）。

---

## 步骤 2 — 让 Mac 加入热点，打通 HTTP 读数

台架测试要读实时 JSON，Mac 需先连上 Arduino 的热点（连上后 Mac 暂时没外网，正常）。

```bash
# 找到 Wi-Fi 接口名（通常 en0）
networksetup -listallhardwareports | grep -A1 Wi-Fi
# 加入热点
networksetup -setairportnetwork en0 VirtualLibrarian casa2026
sleep 5
curl -s http://192.168.4.1/sensors
```

期望返回一行 JSON，例如：

```json
{"distance_mm":642,"presence":0,"temp_c":22.5,"humidity_pct":41.2,...
 "sensors":{"tof":1,"env":1,"rfid":1,"env_chip":"BME280"},"uptime_ms":...}
```

确认 `sensors` 里三个都是 1，再进行步骤 3。

---

## 步骤 3 — 台架测试（5 项，每项用 curl 验证）

用一个轮询循环边看边做物理动作：

```bash
while true; do curl -s http://192.168.4.1/sensors; echo; sleep 1; done
```

| # | 物理动作 | 期望 JSON 变化 |
|---|---|---|
| 1 | 手掌放 ToF 前方 ~30cm | `distance_mm` 变小，`presence:1` |
| 2 | 手拿开等 5 秒 | `presence:0` |
| 3 | 对 BME280 哈气 | `humidity_pct` 升高（BMP280 则恒为 null，正常） |
| 4 | 贴 NTAG213 的书放到 RC522 上 | `book_uid` 出现十六进制，`book_present:1` |
| 5 | 把书拿走等 3 秒 | `book_uid:""`，`book_present:0` |

每读到一个新书的 UID 记下来（步骤 4 会用到）。`Ctrl+C` 结束循环。

测完把 Mac 的 Wi-Fi 切回正常网络：

```bash
networksetup -setairportnetwork en0 <你平时的WiFi名> <密码>
```

---

## 步骤 4 — 登记书的 UID（可选，有书才做）

把步骤 3 读到的每个 `book_uid` 连同书名报给负责人，填进 `bookDb.js` 的 `BOOK_TAGS`
（例：`04A1B2C3` = 霍金《时间简史》）。**这一步只改数据映射，不动逻辑。**

---

## 输出报告格式

测完贴一张结果表：

```
步骤1 自检：tof=_ env=_ rfid=_
步骤2 HTTP：通 / 不通
步骤3 台架：
  1 presence 出现：✅/❌
  2 presence 5秒消失：✅/❌
  3 湿度变化：✅/❌（或 BMP280 无湿度）
  4 book_uid 出现：✅/❌  读到的UID：____
  5 book 3秒清空：✅/❌
```

任何一项 ❌ 且属于接线问题，停下报告，不要改固件代码。
