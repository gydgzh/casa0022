# SYSTEM_DESIGN.md — 完整系统设计（硬件接线 + 软件架构）v3

> 2026-06-12。基于 PROJECT_HANDOFF.md + 实际到货传感器。
> 重要发现：照片里的 **HW-843 = VL53L0X 激光 ToF 测距模块**（不是计划中的
> VL53L1X，量程 ~2 m，桌面 presence 检测足够，库不同，见 §4）。

---

## ★ v3 当前实现（2026-06-12 已写完代码）

**当前实际只接 3 个传感器**：VL53L0X + BME/BMP280 + RC522。
TEMT6000 / PIR / OLED / WS2812B 暂不接，固件对缺失传感器自动降级
（JSON 输出 null），以后随插随用。

已实现（本次改动的文件）：

| 文件 | 内容 |
|---|---|
| `arduino/library_sensors/library_sensors.ino` | v3 固件：3 传感器 + HTTP/AP 骨架不变 + BME/BMP 自动判别 + RFID 持卡检测（WUPA 唤醒，书一直放着也不会误报拿走）+ 全部非阻塞 |
| `arduino/wiring.txt` | v3 面包板接线参考 |
| `scripts/flash-arduino.sh` | 自动安装新库：Pololu VL53L0X、Adafruit BME280/BMP280、MFRC522 |
| `src/sensors.js` | 解析 v3 字段（distanceCm/presence/tempC/humidity/bookUid…），mock 同步更新 |
| `src/dashboard.js` | 行改为 Distance/Temp/Humidity + Reader present + "Reading: 书名" |
| `src/bookDb.js` | `BOOK_TAGS` UID→书映射、`bookByUid()`、新版 `pickMoodFromSensors`（presence/distance/temp/humidity）、桌上有书→直接推荐同主题电影 |
| `src/main.js` | 推荐器传新字段；**avatar 显隐门**（presence=0 超 5 s 渐隐，回来渐显，仅视觉、不动语音管线）；Settings "Test Arduino" 按钮 |
| `index.html` | Settings 面板加 Test Arduino 按钮 + 结果行 |
| `docs/wiring_diagram_v3_minimal.svg` | **当前 3 传感器接线图（论文用这张）** |

接线（详见 SVG 和 wiring.txt）：3V3/GND 共轨 → 三个模块；
I²C（D11/D12）→ VL53L0X + BME280 并联；SPI → RC522（SS=D5, RST=D4,
MOSI=D8, SCK=D9, MISO=D10）。⚠ RC522 只能 3V3；本版**不需要 5V**。

JSON v3（`GET /sensors`）：

```json
{ "distance_mm":642, "presence":1,
  "temp_c":22.5, "humidity_pct":41.2, "pressure_hpa":1012.3,
  "book_uid":"04A1B2C3", "book_present":1,
  "motion":1,
  "sensors":{"tof":1,"env":1,"rfid":1,"env_chip":"BME280"},
  "uptime_ms":123456 }
```

功能（demo 叙事，论文 evaluation 可逐条测）：
1. **有人才出现**：读者走近 < 1 m → avatar 渐显开始互动；离开 5 s → 渐隐。
2. **知道你在读什么**：贴 NTAG213 的书放在盒上 → dashboard 显示
   "Reading: 书名"，并直接推荐同主题电影（霍金的书 → Theory of Everything）。
3. **感知环境**：距离/温度/湿度 → 电影 mood（无人=atmospheric、
   近距离阅读=contemplative、冷=偏 contemplative、热/闷=偏 atmospheric）。
4. **语音荐书**不变（SFSpeechRecognizer → recommendBookFromSpeech）。
5. **自检**：Settings ▸ Test Arduino 一键显示 tof/env/rfid 状态 + 实时读数。

贴纸登记流程：书内贴 NTAG213 → 放盒上 → 串口/Test 按钮读 UID →
填进 `src/bookDb.js` 的 `BOOK_TAGS`。未登记的书也能检测（显示 UID）。

验证：
```bash
cd 1111D && node --check src/sensors.js && node --check src/bookDb.js \
  && node --check src/dashboard.js && node --check src/main.js
bash scripts/flash-arduino.sh        # 编译+烧录+拿 IP
curl -s http://<IP>/sensors | python3 -m json.tool
npm run ios:sync && npm run ios:open # 重装 iPad app
```

以下 v2 章节是完整规划（含待到货件、PCB、外壳），仍然有效；
PCB §6 和外壳 §7 按 3 传感器先做也成立（J1/J5/J6 留空位即可）。
配套全量接线图：`docs/wiring_diagram_v2.svg`。

---

## 1. 最终部署架构（无 Mac）

```
┌──────────────────────────────────────────────┐
│ SENSOR BOX（MKR WiFi 1010 + 自制 PCB shield）│
│  TEMT6000 / VL53L0X / BME-BMP280 / RC522     │
│  / HC-SR501（备份）/ [OLED + WS2812B 待到货] │
│  USE_AP=1 → 自建 Wi-Fi "VirtualLibrarian"    │
│  HTTP :80  GET /sensors → JSON v2            │
└────────────────────┬─────────────────────────┘
                     │ Wi-Fi（iPad 直连 Arduino 热点）
                     ▼
┌──────────────────────────────────────────────┐
│ iPad（Capacitor 原生 app，已完成）            │
│  Settings ▸ Arduino IP = 192.168.4.1         │
│  每 1 s 轮询 /sensors → dashboard + 推荐器    │
│  distance 驱动 avatar 显隐（Andy 反馈 #4）    │
│  book_uid 驱动 "正在读的书"（Andy 反馈 #5）   │
└──────────────────────────────────────────────┘
```

展场流程：两个 USB 电源（iPad 一个、Arduino 一个，照片里的 Adapter）→
Arduino 上电自建热点 → iPad 设置里连 "VirtualLibrarian" → 打开 app 即可。
Mac 只在烧录固件和装 app 时用一次，现场不需要。

---

## 2. 传感器清单（已到货 ✓ / 待到货 ◌）

| 状态 | 模块 | 接口 | 电压 | 作用 |
|---|---|---|---|---|
| ✓ | TEMT6000 | 模拟 A0 | 3V3 | 环境光 → 电影 mood |
| ✓ | HW-843（VL53L0X ToF） | I²C 0x29 | 3V3 | 距离 → presence / avatar 显隐 |
| ✓ | BME/BMP280 | I²C 0x76 或 0x77 | 3V3 | 温度(+湿度+气压) → 推荐权重 |
| ✓ | RC522 RFID | SPI | **只能 3V3** | 桌上的书 → book_uid |
| ✓ | HC-SR501 PIR | 数字 D2 | **5V** | 大范围动作（备份/辅助） |
| ◌ | SSD1306 OLED 0.96" | I²C 0x3C | 3V3 | 盒上诊断屏（IP/读数） |
| ◌ | WS2812B 8-LED 环 | 数字 D3 | 5V 供电 | 展览氛围反馈 |

⚠️ BME280 vs BMP280 的区分：很多便宜板丝印 "BME/BMP280" 实为 BMP280
（**无湿度**）。固件开机读 chip-ID 寄存器 0xD0：`0x60` = BME280（有湿度），
`0x58` = BMP280（湿度字段输出 null）。两种都兼容，见 §4。

---

## 3. 接线总表（MKR WiFi 1010）

### 3.1 总线分配

| 总线 | MKR 引脚 | 挂载设备 |
|---|---|---|
| I²C | SDA = **D11**, SCL = **D12** | VL53L0X (0x29) + BME280 (0x76/77) + OLED (0x3C) — 三个并联，地址无冲突 |
| SPI | MOSI = **D8**, SCK = **D9**, MISO = **D10** | RC522 |
| 模拟 | **A0** | TEMT6000 |
| 数字 | **D2** | PIR OUT |
| 数字 | **D3** | WS2812B DIN |
| 数字 | **D4** | RC522 RST |
| 数字 | **D5** | RC522 SS/SDA |

> ⚠️ 设计修正：HANDOFF §9 写的 RFID 用 "D5/D6"——**D6 是 MKR WiFi 1010
> 的 LED_BUILTIN**（现有 sketch 用它做心跳闪灯），所以 RST 改到 **D4**。
> PCB 画图时按本表，不要按旧文档。

### 3.2 逐线接法

```
MKR 3V3 ──┬── TEMT6000 VCC
          ├── VL53L0X VIN
          ├── BME280 VIN
          ├── RC522 3.3V        ⚠️ RC522 绝对不能接 5V
          └── OLED VCC          （到货后）

MKR 5V  ──┬── HC-SR501 VCC      ⚠️ PIR 要 5V
          └── WS2812B 5V        （到货后）

MKR GND ─── 所有模块 GND（共地排）

A0  ─── TEMT6000 SIG
D2  ─── HC-SR501 OUT            （输出 3.3V 电平，安全）
D3  ─── 330Ω 串联电阻 ─── WS2812B DIN
D11 ─── VL53L0X SDA ── BME280 SDA ── OLED SDA   （并联）
D12 ─── VL53L0X SCL ── BME280 SCL ── OLED SCL   （并联）

RC522（7 根线）:
  SDA(SS) ─── D5      SCK  ─── D9
  MOSI    ─── D8      MISO ─── D10
  RST     ─── D4      IRQ  ─── 不接
  3.3V / GND 如上
```

注意事项：
1. I²C 上拉电阻三块 breakout 板上都自带，直接并联即可，不用额外加。
2. WS2812B 数据脚理论要 ≥3.5V，MKR 输出 3.3V——8 颗灯短线 + 330Ω 串阻
   实测普遍可用；若闪烁异常，把灯环供电从 5V 改接 3V3（亮度略降，电平匹配）。
3. VL53L0X 前方必须是**开孔**，不能隔亚克力/PLA（红外会被挡）。
4. RC522 天线隔 2–3 mm 的 MDF/PLA 没问题 → 装在外壳盖板下面，盖板上
   印一个书形轮廓 "PLACE BOOK HERE"，NTAG213 贴纸读距 ~2 cm。
5. 全部电流（含灯环低亮度）< 500 mA，一个普通 USB 适配器够。

---

## 4. Arduino 固件计划（library_sensors.ino v2）

现有 HTTP server / Wi-Fi AP / CORS 逻辑**不动**，只扩展读数。

库（Library Manager）：

| 库 | 用途 |
|---|---|
| WiFiNINA（已有） | Wi-Fi + HTTP |
| Pololu **VL53L0X** | ToF。注意 HW-843 是 L0X，**不要装 VL53L1X 的库** |
| Adafruit BME280 + Adafruit BMP280（+ Unified Sensor） | 0xD0 chip-ID 自动判别，二选一初始化 |
| MFRC522（miguelbalboa / GithubCommunity） | RFID |
| Adafruit SSD1306 + GFX | OLED（到货后） |
| Adafruit NeoPixel | 灯环（到货后） |

JSON v2（`GET /sensors`，新增字段加在后面，旧字段不动 → iPad 旧版也兼容）：

```json
{
  "lux": 123.4, "lux_raw": 512, "motion": 1,
  "distance_mm": 642, "presence": 1,
  "temp_c": 22.5, "humidity_pct": 41.2, "pressure_hpa": 1012.3,
  "book_uid": "04A1B2C3D580", "book_present": 1,
  "uptime_ms": 123456
}
```

逻辑要点：
* `presence` = (distance_mm < 1000) **OR** motionLatched。ToF 为主，PIR 兜底。
* BMP280（无湿度）时 `humidity_pct` 输出 `null`。
* RFID：每次 loop 轮询 `PICC_IsNewCardPresent()`；UID 转大写 hex 串；
  连续 3 s 读不到卡 → `book_present:0`、`book_uid:""`（书拿走了）。
* 传感器读取节流 200 ms 一轮，非阻塞（millis()，不要 delay），保证
  HTTP 响应 < 50 ms。
* 开机 OLED 显示：SSID / IP / 各传感器 OK-FAIL 自检结果（拍照素材，
  Andy 反馈 #7）。
* 灯环状态：无人=暗蓝呼吸，有人靠近=暖白渐亮，识别到书=绿色脉冲 2 s。

---

## 5. iPad App 改动（少量，硬件才是重点）

| 文件 | 改动 |
|---|---|
| `src/sensors.js` | 解析新字段，缺字段时回退旧行为 |
| `src/dashboard.js` | ROWS_ARDUINO 加：Temp / Humidity / Distance / Book |
| `src/bookDb.js` | ① `BOOK_TAGS = { "04A1B2…": bookId }` UID→书映射（贴好 NFC 贴纸后用 OLED/串口读出 UID 填表）② `recommendFilmFromSensors` 加入 distance/temp/humidity/book 权重（映射表见下）③ 桌上有书时优先按该书 topic 推荐同主题电影 |
| `src/main.js` | avatar 显隐门：`presence==0` 持续 > 5 s → CSS opacity 渐隐 + `speech.stop()`；恢复时渐显 + 重启 listening（Andy 反馈 #4） |
| Settings 面板 | 加 "Test Arduino" 按钮：fetch /sensors → toast 显示 JSON（HANDOFF §13 待办） |

电影 mood 映射表 v2：

| 环境状态 | mood bucket |
|---|---|
| 暗（<150 lux）+ 无人 | atmospheric |
| 暗 + 有人（distance < 1 m） | contemplative |
| 亮 + 安静（motion 少） | classic |
| 亮 + 活跃 | energetic |
| 冷（<18 °C） | classic/contemplative +权重 |
| 热（>26 °C）或湿度 >65 % | atmospheric +权重 |
| 桌上有书 | 该书 topic 同主题电影直接置顶 |

**不碰**：pyramid.js、语音链路（SFSpeechRecognizer）、已锁定架构。

---

## 6. PCB shield v1（EasyEDA → JLCPCB）接口分配更新

60 × 40 mm 双面板、两条 14-pin 母排插 MKR，连接器按实际到货改为：

| 接口 | 类型 | 引出 |
|---|---|---|
| J1 LIGHT | JST-PH 3-pin | 3V3 / GND / A0 |
| J2 I2C-A | JST-PH 4-pin | 3V3 / GND / SDA / SCL（VL53L0X） |
| J3 I2C-B | JST-PH 4-pin | 同上并联（BME280） |
| J4 I2C-C | JST-PH 4-pin | 同上并联（OLED） |
| J5 PIR | JST-PH 3-pin | 5V / GND / D2 |
| J6 LED | JST-PH 3-pin | 5V / GND / D3（板上串 330Ω） |
| J7 RFID | 2×4 排针 2.54 | 3V3 GND D5 D4 D8 D9 D10 NC |
| 板上 | — | 电源 LED + 330Ω、复位按钮、丝印标签 + GitHub QR |

丝印："CASA0022 — Library Sensor Node v1 · Yidan Gao · 2026"。
I²C 三个连接器物理并联，走线一对 SDA/SCL 即可。

---

## 7. 外壳更新（对 HARDWARE_PLAN §4 的修订）

传感器盒盖板开窗改为：

| 窗口 | 规格 |
|---|---|
| TEMT6000 | ⌀10 mm 透明窗（不变） |
| VL53L0X | **⌀8 mm 通孔（开孔，不能盖透明片）**，朝向读者方向（盒子侧面或斜面更合理） |
| BME280 | 2×4 通风槽（不变） |
| PIR | ⌀22 mm 半球孔（不变） |
| OLED | 25×14 mm 方窗 |
| RFID | 不开孔；天线贴盖板内侧，盖板丝印/雕刻书形轮廓 "PLACE BOOK HERE" |
| 灯环 | 盖板边缘环形透光槽或磨砂亚克力条 |

建议：VL53L0X 开在**朝向读者的竖直面**（测人的距离，不是测天花板），
RFID 区在盖板水平面（放书）。激光切割 MDF 方案不变。

---

## 8. 验证命令（烧录后逐条跑）

```bash
bash scripts/flash-arduino.sh            # 编译+烧录+读串口拿 IP
curl -s http://<IP>/sensors | python3 -m json.tool   # JSON v2 全字段
# 手测：手挡 ToF → distance_mm 变小、presence:1
#       拿走手 + 不动 5s → presence:0
#       NFC 贴纸放 RFID 上 → book_uid 非空
#       手指盖 TEMT6000 → lux_raw < 30
bash scripts/verify-arduino.sh           # 连续 5 次轮询稳定性
```

---

## 9. 复杂度对标（往年 CASA0022）

往年（WeatherScribe、Water Scout、Smart Home Twin 等）= 多传感器节点 +
自制外壳 + 数据管线 + 5,500–6,000 词 + GitHub + 演示视频。本项目
（6 传感器 + 自制 PCB + 双外壳 + 原生 iPad app + Pepper's Ghost 光学装置）
复杂度在该基准之上，PCB 是多数往年项目没有的加分项——与 Andy 的评分
导向一致。

---

## 10. 下一步（按序执行）

1. 按 §3 在面包板接好全部传感器（先不等 PCB）→ 拍照发 Slack。
2. 写固件 v2（§4）→ 跑 §8 验证。
3. EasyEDA 画 shield（§6）→ 本周内下单 JLCPCB DHL Express。
4. iPad app 四个小改动（§5）→ rebuild 一次。
5. Fusion 360 外壳按 §7 修订 → 激光切割。
