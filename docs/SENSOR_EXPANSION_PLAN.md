# SENSOR_EXPANSION_PLAN.md

> Things to buy after the TEMT6000 + PIR baseline is working. Each tier
> takes ≤ 1 day of code to integrate; the Arduino sketch already publishes
> a JSON dict, so adding a new field is one `client.print(...)` line.

---

## Tier 1 — Andy's email asks (do these first, total ~£25)

| Part | £ | Why |
|---|---|---|
| **BME280** breakout (I2C, addr 0x76) | 8 | Temperature + humidity + barometric pressure. Andy specifically asked for these alongside light/sound. Adds the "is this a comfortable reading room?" dimension. |
| **SGP40** breakout (I2C, addr 0x59) | 15 | VOC index (0-500). De-facto proxy for "is the air stuffy / over-crowded". Pairs well with the avatar's mood overlay — when VOC > 200 the librarian could yawn or suggest opening a window. |

Both share the same SDA/SCL bus (pins 11 + 12 on the MKR), so wiring is
just three wires apiece + 3 V3 + GND. The breakouts include 10 kΩ pull-ups
already; no extra resistors needed.

Arduino library additions (Arduino IDE Library Manager):
- *Adafruit BME280 Library* (pulls in *Adafruit Unified Sensor*)
- *Adafruit SGP40 Sensor*

In `library_sensors.ino`, the additional JSON fields become:

```cpp
client.print(F(",\"temp\":"));     client.print(bme.readTemperature(), 1);
client.print(F(",\"humidity\":")); client.print(bme.readHumidity(), 0);
client.print(F(",\"voc\":"));      client.print(sgp.measureVocIndex(t, h));
```

…and on the iPad the dashboard already has rendering slots for Temp,
Humidity, and Air (VOC) that just show "—" while the keys are missing.
Drop the new fields in and they'll start populating without touching JS.

---

## Tier 2 — directly answer Andy's "what books are people reading" ask

| Part | £ | Why |
|---|---|---|
| **MFRC522 RFID reader module** (SPI) | 3 | Stick a 13.56 MHz NFC sticker (£0.20 each, 100 for £8) inside the back cover of 5–10 demo books. When a visitor places one on a marked square on the table, the reader sees the tag UID, the Arduino includes it in the JSON, the iPad app maps UID → book title → animates the librarian saying *"That's a great choice — Sapiens by Yuval Noah Harari…"* |

This is the most direct "Sense → Deploy → Communicate" closure in the
project. It also gives the dissertation a concrete on-table interaction
that visitors can replicate.

Library: *MFRC522* by GithubCommunity. SPI uses 4 pins on the MKR
(SCK 9, MISO 10, MOSI 8, SS pick any unused like D5, plus 3 V3 + GND).

---

## Tier 3 — visitor-count / engagement signals (nice-to-have)

| Part | £ | Why |
|---|---|---|
| **VL53L0X** time-of-flight ranger (I2C) | 5 | Mount it pointing across a doorway / past the pyramid's edge. Each time the reading drops below a threshold = one entry/exit event. Gives a sensible "visitors in the last hour" line on the dashboard. |
| **INMP441** I²S digital mic | 8 | Cheap calibrated dB meter without the AGC weirdness of MAX9814. Lets you log noise levels alongside iPad-side speech for the dissertation evaluation. Lower priority because the iPad mic already covers sound. |
| **ePaper 2.13" display** for the Arduino | 18 | An always-on "Now reading: …" label that the iPad pushes to the Arduino. Pure presentation, helps for the exhibition photo set. |

---

## Tier 4 — MKR WAN 1310 you already own (LoRa remote node)

When the dissertation needs a "scale beyond Wi-Fi reach" story, this is
the angle. The 1310 sits in the next room with its own TEMT6000 + PIR,
sends a small LoRa packet every 30 s back to the 1010 (which acts as
LoRa gateway → re-emits as JSON via the existing HTTP server).

Code change: add `#include <MKRWAN.h>` to the 1310 sketch, use `LoRa.send()`
in a watchdog loop. On the 1010 add `LoRa.parsePacket()` poll alongside
the HTTP server. Costs you ~150 lines and a £0 hardware bill since you
already have the boards.

---

## Decision tree — what to buy this week

```
Has Andy seen your demo yet?
├── No  → buy Tier 1 only (£23), iterate
└── Yes → demo went well?
          ├── Yes → buy Tier 2 (£3 + £8 sticker pack), prepare the
          │         "what is this person reading" story for the report
          └── No  → tweak the existing UI first; sensor budget can wait
```

---

## What the dashboard layout already handles

Each new field is rendered automatically if you add a row to `ROWS_ARDUINO`
in `src/dashboard.js`. Example for BME280:

```js
const ROWS_ARDUINO = [
  { key: 'lux',      label: 'Light',       unit: 'lux', decimals: 0 },
  { key: 'temp',     label: 'Temperature', unit: '°C',  decimals: 1 },
  { key: 'humidity', label: 'Humidity',    unit: '%',   decimals: 0 },
  { key: 'voc',      label: 'Air (VOC)',   unit: 'idx', decimals: 0 },
];
```

`src/sensors.js` already reads `j.temp`, `j.humidity`, `j.voc` from the
JSON if Arduino sends them — those keys just need to start arriving.
