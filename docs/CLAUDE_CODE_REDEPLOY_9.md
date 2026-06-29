# CLAUDE_CODE_REDEPLOY_9.md — v3 三传感器上线（VL53L0X + BME/BMP280 + RC522）

> 这一轮的代码**已经全部写好**（Cowork 对话完成），不需要重写任何逻辑。
> Claude Code 的任务只有：验证 → 编译烧录 → 重建 iPad app → 帮用户跑测试。
> ⚠ 如果哪个验证失败，先报告，不要自作主张重构（尤其不要碰
> pyramid.js / speechNative.js / 语音管线）。

---

## Files changed this round（已完成，勿重写）

| File | What |
|---|---|
| `arduino/library_sensors/library_sensors.ino` | v3 固件：VL53L0X(I²C 0x29) + BME/BMP280(0x76/77 chip-ID 自动判别) + RC522(SPI, SS=D5, RST=D4)；HTTP/AP 骨架与 v2 完全一致；缺失传感器输出 null |
| `arduino/wiring.txt` | v3 面包板接线参考 |
| `scripts/flash-arduino.sh` | 自动安装 Pololu VL53L0X / Adafruit BME280+BMP280 / MFRC522 |
| `src/sensors.js` | 解析 distance_mm→distanceCm、presence、temp_c、humidity_pct、book_uid 等；mock 同步 |
| `src/bookDb.js` | BOOK_TAGS、bookByUid()、新 pickMoodFromSensors、书→电影直推 |
| `src/dashboard.js` | Distance/Temp/Humidity 行 + Reader present + Reading: 书名 |
| `src/main.js` | 推荐器新字段；avatar presence 显隐门；Settings Test Arduino 按钮 |
| `index.html` | Settings 面板 Test Arduino 按钮 |

---

## 人 vs Claude Code 分工

**用户（动手部分）**：
- A1. 按 `arduino/wiring.txt` 在面包板接 3 个传感器（3V3/GND 共轨；
  I²C 两根并联；RC522 七根线。⚠ RC522 接 3V3，不要 5V）
- A2. USB 线连 Arduino 到 Mac（要数据线，不是充电线）
- A3. 决定 Wi-Fi 模式：在家测试用 USE_AP=0（家里 Wi-Fi），
  展览/答辩用 USE_AP=1（iPad 连 "VirtualLibrarian"）
- A4. Xcode 里点 ▶ 装 app 到 iPad（步骤 5 之后）
- A5. 物理测试 + 拍照发 Slack 给 Andy（接线照、串口截图、dashboard 截图）

**Claude Code（命令部分）**：步骤 1–6。

---

## Claude Code: run these in order

### 1. 验证代码就位（30 秒）

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"
grep -c "VL53L0X" arduino/library_sensors/library_sensors.ino   # 期望 ≥ 4
grep -c "MFRC522" arduino/library_sensors/library_sensors.ino   # 期望 ≥ 4
grep -n "PIN_RFID_RST = 4" arduino/library_sensors/library_sensors.ino  # RST=D4（D6 是 LED_BUILTIN）
node --check src/sensors.js && node --check src/bookDb.js \
  && node --check src/dashboard.js && node --check src/main.js && echo JS_OK
grep -c "set-test-arduino" index.html src/main.js               # 各 ≥ 1
```

全部通过才继续；失败就停下报告哪一条。

### 2. 检查 Wi-Fi 配置

```bash
grep "define USE_AP" arduino/library_sensors/library_sensors.ino
grep -L "REPLACE_WITH_YOUR_SSID" arduino/library_sensors/arduino_secrets.h && echo SECRETS_OK
```

- 用户在家测试 → 确认 `USE_AP 0` 且 secrets 里是家里 Wi-Fi（iPad 同一网络）。
- 展览模式 → 改成 `USE_AP 1`（iPad 没外网，语音识别会受影响，仅展示用）。

### 3. 编译 + 烧录 + 拿 IP

```bash
bash scripts/flash-arduino.sh
```

期望串口输出（顺序）：
```
[boot] library_sensors.ino v3 (VL53L0X + BME/BMP280 + RC522)
[tof]  VL53L0X OK (0x29)
[env]  BME280 OK at 0x76        ← 或 BMP280 OK（板子是 BMP，湿度会是 null，正常）
[rfid] RC522 OK (version 0x92)  ← 0x91/0x92 都正常
[wifi] OK ip=192.168.x.x        ← 记下这个 IP
[http] listening on http://...:80/sensors
```

任何一行变成 NOT FOUND → 跳到 Troubleshooting，让用户检查对应接线，
修好后重跑本步。**不要在传感器没接好时去改固件。**

### 4. 台架测试（curl，5 项）

```bash
IP=<上一步的IP>
curl -s http://$IP/sensors | python3 -m json.tool
```

逐项让用户配合做动作，每做一个就再 curl 一次：

| # | 用户动作 | 期望 JSON 变化 |
|---|---|---|
| 4.1 | 手掌放在 VL53L0X 前 ~30 cm | `distance_mm` ≈ 300，`presence:1` |
| 4.2 | 手拿开，等 5 秒 | `distance_mm` 变大或 null，`presence:0` |
| 4.3 | NTAG213 贴纸/有贴纸的书放 RC522 上 | `book_uid:"04..."`，`book_present:1` |
| 4.4 | 书一直放着再 curl 两次 | `book_uid` 不变（持卡检测，不会闪断） |
| 4.5 | 拿走书等 3 秒 | `book_present:0`，`book_uid:""` |

加一项环境：对 BME280 哈气 → `humidity_pct` 上升（BMP280 板无此项）。
记录 4.3 读到的每本书 UID，第 6 步要用。

### 5. 重建 iPad app

```bash
cd "$DLL"
npm run ios:sync
npm run ios:open     # 打开 Xcode，用户选 iPad target → ▶
```

装好后用户在 iPad 上：⚙︎ Settings → Arduino IP 填步骤 3 的 IP →
点 **Test Arduino** → 应显示绿色一行
`✓ tof:1 env:1(BME280) rfid:1 · 45cm 22.5°C` → Save & reload。

### 6. NFC 书籍登记（每本书一次）

把步骤 4.3 记下的 UID 填进 `src/bookDb.js` 的 `BOOK_TAGS`，例如：

```js
export const BOOK_TAGS = {
  '04A1B2C3': 'A Brief History of Time',
  '04D5E6F7': 'The Library at Night',
};
```

标题必须与 MEDIA 数组里的 `title` 完全一致。然后：

```bash
node --check src/bookDb.js && npm run ios:sync   # 再到 Xcode ▶ 重装
```

---

## iPad 整机验收（用户做，逐条勾）

| # | 动作 | 期望 |
|---|---|---|
| T1 | 人坐到装置前（< 1 m） | avatar 1 秒左右渐显；dashboard "Reader present" |
| T2 | 走开站到 2 m 外，等 6 秒 | avatar 渐隐；"No reader" |
| T3 | 回来坐下 | avatar 渐显回来，语音继续可用（语音从未被关） |
| T4 | 放登记过的书（如霍金） | "Reading: A Brief History of Time"；电影推荐变 The Theory of Everything，match 行显示 `book: ...` |
| T5 | 放未登记的书 | "Reading: tag 04XXXXXX"（检测到但未登记） |
| T6 | 拿走书 | 3 秒后回到环境 mood 推荐 |
| T7 | 说 "I want to read about physics" | Suggested book 出 physics 书（原功能未破坏） |
| T8 | dashboard 数值 | Distance/Temp/Humidity 实时跳动，Distance 有 sparkline |

T1–T8 全过 = 本轮完成。**拍 T1/T4 的照片发 Slack。**

---

## Troubleshooting

| 症状 | 原因 → 处理 |
|---|---|
| `[tof] NOT FOUND` | I²C 线错/松。查 SDA→D11、SCL→D12、VIN→3V3。两个 I²C 模块共用总线，BME 也会一起失联 |
| `[env] NOT FOUND` 但 tof OK | BME 板的 SDA/SCL 接反，或地址焊盘改成了 0x77 之外 → 单独换线重试 |
| `[rfid] version reg 0xFF 或 0x00` | SPI 线错（最常见 SS/RST 对调，或 MISO/MOSI 对调）；确认 SS=D5、RST=D4 |
| `humidity_pct: null` 但 env OK | 板子是 BMP280，不是 BME280 —— 正常，不是 bug；论文里写明即可 |
| `distance_mm: null` 一直 | ToF 前方 > 2 m 没东西属正常；若手放上去也是 null → 模块前的保护膜没撕 |
| 书放着却 `book_present` 闪 0/1 | 贴纸离天线太远 → 直接贴在 RC522 线圈正上方测试；隔板别超过 3 mm |
| iPad Test Arduino 红色 ✗ | iPad 和 Arduino 不在同一 Wi-Fi；或 IP 输错；USE_AP=1 时 IP 固定 192.168.4.1 |
| avatar 一直不隐藏 | sensors=mock 或 presence 字段 null 时显隐门故意不生效 —— 确认 Settings 填了真 IP（sensors=1） |

---

## 给 Claude Code 的开场白（用户直接复制）

```
读 /Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D/docs/CLAUDE_CODE_REDEPLOY_9.md
按步骤 1-6 顺序执行，每步贴出验证命令的输出再进行下一步。
代码已经写好，验证失败时停下来报告，不要重写逻辑，不要碰 pyramid.js 和语音相关文件。
现在从步骤 1 开始。
```
