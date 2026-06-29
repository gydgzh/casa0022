# HARDWARE_PLAN.md — Sensor box + Pepper's-Ghost enclosure + PCB

> Supervisor (Andy) made clear the dissertation will be marked on the
> **physical artefact**, not the iPad app code:
>   - Custom PCB (not breadboard wires loose in a box)
>   - 3D-printed or laser-cut enclosure for the iPad-pyramid
>   - Separate sensor module enclosure
>   - Sensors he named: **light + temperature + sound + PIR motion**
>   - PCB lead time ~2 weeks → must order this week.
>
> This document is the complete hardware spec + ordering list + Fusion
> 360 / EasyEDA brief. The timeline targets a working physical demo two
> weeks from now, with the iPad-app side already done.

---

## 1. System block diagram

```
┌───────────────────────────────────────────────────────────────┐
│                      SENSOR MODULE (separate box)             │
│                                                                │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│   │TEMT6000  │   │ BME280   │   │ MAX9814  │   │ HC-SR501 │  │
│   │ (light)  │   │ (temp+h) │   │ (sound)  │   │  (PIR)   │  │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘  │
│        │              │              │              │         │
│        │              │ I2C          │              │         │
│        ▼              ▼              ▼              ▼         │
│   ┌───────────────────────────────────────────────────────┐   │
│   │     CUSTOM PCB (MKR-shield form factor)               │   │
│   │     [Arduino MKR WiFi 1010 plugs on top via headers]  │   │
│   │     JST PH 4-pin connectors for each sensor cable     │   │
│   │     Power LED · Reset · USB-C cutout                  │   │
│   └────────────────────────┬──────────────────────────────┘   │
└────────────────────────────┼──────────────────────────────────┘
                             │ Wi-Fi (HTTP server :80)
                             │ same 2.4 GHz network as iPad
                             ▼
┌───────────────────────────────────────────────────────────────┐
│              IPAD + PEPPER'S-GHOST PYRAMID (separate box)     │
│                                                                │
│      ╭────────────╮                                            │
│      │  Acrylic    │  ← Pepper's-Ghost pyramid (already have)  │
│      │  pyramid    │                                            │
│      ╰─────┬──────╯                                            │
│            │ sits on locating posts                             │
│      ┌─────┴──────────────────────────────────┐                │
│      │      3D-printed base / enclosure       │                │
│      │  ┌────────────────────────────────┐    │                │
│      │  │           iPad (face up)        │    │                │
│      │  │     [native Capacitor app]      │    │                │
│      │  └────────────────────────────────┘    │                │
│      │  USB-C cable exit for power             │                │
│      └────────────────────────────────────────┘                │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Shopping list — order TODAY (UK suppliers)

### Sensors you still need to buy (~£18 + free postage)

| Part | Why | UK supplier | £ |
|---|---|---|---|
| **BME280** breakout (I²C, 0x76) | Andy's "temperature" — also gives humidity + pressure | [Pimoroni — BME280 breakout (PIM472)](https://shop.pimoroni.com/products/bme280-breakout) | 12 |
| **Adafruit MAX9814** mic module | Andy's "sound" sensor, auto-gain control built in | [The Pi Hut — MAX9814](https://thepihut.com/products/electret-microphone-amplifier-max9814-with-auto-gain-control) | 6 |

You **already have** TEMT6000 (light) + HC-SR501 (PIR motion).

### PCB fabrication (~£20 total)

| Item | Vendor | £ |
|---|---|---|
| 5 PCBs, 60×40 mm, double-sided, green soldermask | **JLCPCB** (cheapest + 7-day UK delivery) | 4 |
| DHL Express shipping to London | JLCPCB | 18 |
| **Total PCB:** | | **22** |

> Cheaper option: PCBWay 5 boards + slow post = £8 + £4 shipping but 18 days.
> Don't take this — you need them in a week.

### PCB assembly bits (~£10)

| Item | UK supplier | £ |
|---|---|---|
| 4× JST PH 4-pin male connectors (right-angle, through-hole) | The Pi Hut — JST PH headers pack | 2 |
| 4× JST PH 4-pin female cable harness (200 mm) | Pimoroni | 4 |
| 2× 14-pin 2.54mm female header strips (for MKR) | Pimoroni | 1.50 |
| 1× tactile reset button (6×6mm) | Pimoroni | 0.30 |
| 1× 3 mm green LED + 330 Ω 0805 resistor | Pimoroni | 0.50 |
| Solder, flux, wick (if not already on hand) | Pimoroni soldering starter | 8 |

### 3D printing (free at CASA, or paid)

- **CASA basement printer** — free for students, book through the
  workshop. Bring your own PLA spool (£20) or use lab.
- Alternative: **laser cut MDF/acrylic** at the workshop, 20-minute job
  vs. 6–8 hours of FDM. Andy mentioned this as the time-saving route.

### Pepper's-Ghost optics (you may already have)

- 4-sided acrylic pyramid, **70 mm base** (if matching iPad 9):
  £12 on Amazon UK ("smartphone hologram pyramid")

---

## 3. PCB design — concrete plan

### Form factor

A simple **MKR-WiFi-1010 sensor shield**: same outline as Arduino's
MKR shields (61.5 × 25 mm + extension area). The shield plugs onto the
MKR via two 14-pin female headers; the MKR sits underneath, PCB on top.

I made the board **60 × 40 mm** (taller than standard) so there's room
for the four JST connectors along the edges.

### Schematic (KiCad / EasyEDA)

```
MKR pins              JST connector             Sensor on cable
─────────             ─────────────             ───────────────
 3V3 ─────────────┬── JST1.1 (VCC) ─────────── TEMT6000 VCC
 GND ─────────────┼── JST1.2 (GND) ─────────── TEMT6000 GND
 A0  ─────────────┼── JST1.3 (SIG) ─────────── TEMT6000 OUT
       (NC)       └── JST1.4 (NC)

 3V3 ─────────────┬── JST2.1 (VCC) ─────────── BME280 VCC
 GND ─────────────┼── JST2.2 (GND) ─────────── BME280 GND
 SDA(11) ─────────┼── JST2.3 (SDA) ─────────── BME280 SDA
 SCL(12) ─────────┴── JST2.4 (SCL) ─────────── BME280 SCL

 3V3 ─────────────┬── JST3.1 (VCC) ─────────── MAX9814 VDD
 GND ─────────────┼── JST3.2 (GND) ─────────── MAX9814 GND
 A1  ─────────────┼── JST3.3 (OUT) ─────────── MAX9814 OUT
       (NC)       └── JST3.4 (GAIN)

 5V  ─────────────┬── JST4.1 (VCC) ─────────── PIR VCC  (5V!)
 GND ─────────────┼── JST4.2 (GND) ─────────── PIR GND
 D2  ─────────────┼── JST4.3 (OUT) ─────────── PIR OUT
       (NC)       └── JST4.4 (NC)

 3V3 ─── 330Ω ─── LED ─── GND     (power indicator)
 RESET ─── tactile switch ─── GND  (reset button mirror)
```

### Tooling

- **EasyEDA Pro** (free, browser-based) — directly hooks into JLCPCB
  for one-click ordering. Best for time pressure.
- Alternative: **KiCad** (free, desktop) → export Gerber → upload to
  JLCPCB. More professional but slower for a 1-day job.

### Step-by-step in EasyEDA (allow 3 hours)

1. New project → schematic.
2. Drop 4 JST_PH 4-pin connectors, label sensor names.
3. Drop 2 × `FemaleHeader14Pin_2.54` for the MKR sockets.
4. Wire as per the schematic above.
5. Convert to PCB → board outline 60 × 40 mm → place MKR sockets
   first, JST connectors along three of the four edges.
6. Auto-route. Manually clean up the I²C trace pair.
7. Add silk-screen labels for each sensor + an arrow showing the
   MKR plug-in orientation.
8. DRC → ERC → Export Gerber → "Order PCB now" → JLCPCB checkout.

### What to put on the silk-screen

* Project name: **CASA 0022 — Library Sensor Node**
* Your name, date, version (v1)
* Sensor labels next to each JST: LIGHT / TEMP / SOUND / PIR
* QR code (small) → link to GitHub repo (good for the supervisor's "process documentation" ask)

---

## 4. Sensor-module enclosure — Fusion 360 brief

Two-part shell, screwed together, total **85 × 60 × 30 mm** (just bigger
than the PCB stack).

```
TOP shell (lid):
  - 4 sensor windows (cut-outs) labelled on the lid:
      Light  ⌀10 mm clear (TEMT6000 sees through this)
      Sound  6 × 6 mm grille (mic hole; small mesh sticker behind)
      PIR    ⌀22 mm half-sphere cut-out for the dome
      Temp   2 × 4 slit (BME280 needs airflow; don't seal it)
  - 4 corner countersunk holes for M3 screws
  - "VIRTUAL LIBRARIAN · v1" embossed name on top

BOTTOM shell:
  - PCB-mount bosses: 4 × M2.5 holes at PCB corner positions
  - USB-C cable cutout on the side, 10 × 5 mm
  - 4 mm-tall rubber feet (or just printed feet)
  - Cable routing channel inside for the 4 JST harnesses

Wall thickness: 2 mm (PLA) or 3 mm (laser-cut MDF)
```

### Fusion 360 step-by-step (allow 4 hours)

1. New sketch → rectangle 85 × 60 → extrude 2 mm = bottom plate.
2. Sketch on top face → offset 2 mm from edge → extrude 25 mm = walls.
3. Shell command: open top face, wall thickness 2 mm = main shell.
4. Sketch PCB outline + 4 boss locations → extrude bosses 4 mm up.
5. Drill M2.5 thru-holes in each boss.
6. Lid: new component, same 85 × 60 footprint, 3 mm thick.
7. Sketch the 4 sensor windows + label them with sketch-text → extrude cuts.
8. Add M3 countersunk holes at the corners of both halves.
9. Export STL → slice in PrusaSlicer or Cura → print at 0.2 mm layer,
   ~3 h per half on a Prusa Mk3.

### Faster alternative — laser-cut MDF box

Andy specifically mentioned this for time-saving:
1. Make 6 rectangle faces in Fusion 360 (sides, top, bottom).
2. Add finger-joint tabs along edges (Fusion has a built-in
   "finger-joint" tool, or use [makercase.com](https://makercase.com/) — paste
   dimensions, get DXF in 60 seconds).
3. Add sensor windows + sensor labels engraved.
4. Bring DXF to the CASA workshop laser cutter: 20 minutes to cut.
5. Glue with wood PVA; M3 nuts trapped in slots for the lid.

This route saves ~6 hours of print time per iteration.

---

## 5. iPad-pyramid base — Fusion 360 brief

```
BOTTOM (base plate): 280 × 200 × 5 mm (iPad-9 footprint + 20 mm border)
  - iPad recess: 250 × 175 × 8 mm sunk pocket, centred
  - USB-C cable channel: 5 × 8 mm slot exiting one short edge
  - 4 corner rubber-foot bosses (3 mm)

TOP (pyramid mount): 80 × 80 × 4 mm
  - Sits centred on the iPad recess area
  - 4 small locating posts (5 mm tall, 2 mm diameter) to hold the
    acrylic pyramid's base in place
  - Cut-out in the centre 60 × 60 mm so the iPad screen shows through
  - Tasteful chamfer around the cut-out

OPTIONAL: light shroud
  - 100 mm-tall ABS shroud surrounding the pyramid, matte black inside,
    so ambient light doesn't wash out the Pepper's-Ghost reflection.
```

Print time at 0.2 mm: ~6 h base + 1 h pyramid mount.

---

## 6. Two-week timeline (working backwards from Andy's deadline)

| Day | Task | Output |
|---|---|---|
| Mon (today) | Order BME280 + MAX9814 from Pimoroni (next-day post if you order by 4pm); start EasyEDA schematic | Sensors en route + schematic done |
| Tue | Finish PCB layout, run DRC, export Gerber, upload to JLCPCB, pay for DHL Express | PCB on a 7-day delivery clock |
| Wed | Start sensor-module enclosure in Fusion 360; book CASA 3D printer | Fusion model saved |
| Thu | Sensor-module enclosure: print bottom half (or laser-cut all faces); iterate dimensions on test print | First physical box |
| Fri | Sensor-module top half; trial-fit electronics on breadboard inside the box for ergonomics | Fit check done |
| Sat-Sun | Start iPad-pyramid base in Fusion 360 | Base CAD done |
| Mon  | Print iPad-pyramid base (~6 h) | First base print |
| Tue  | Sensors arrive (if not already) + PCB arrives | All parts in hand |
| Wed  | Solder JST headers, components onto PCB | Populated PCB |
| Thu  | Connect sensors to PCB via JST cables, flash Arduino sketch, test on bench | Working module |
| Fri  | Final assembly: PCB into enclosure, sensors into windows, screw shut | Sealed sensor box |
| Sat  | Photo documentation of every step (Andy explicitly asked for this) | Photos for report |
| Sun  | Full system test: sensor box + iPad on Pepper's-Ghost mount + virtual librarian responds to environment | Working demo |

If anything slips, the laser-cut box buys back ~6 h per iteration.

---

## 7. Documentation Andy asked for explicitly

Take a photo at every milestone — these are direct evidence for the
dissertation methodology chapter:

1. EasyEDA screenshot of finished schematic + 3-D board preview.
2. JLCPCB order screenshot.
3. PCB out of the antistatic bag, unpopulated.
4. PCB partially soldered (silk-screen visible).
5. Each sensor connected via JST cable, on the desk.
6. Fusion 360 screenshot of each enclosure.
7. First print pulled off the bed.
8. Trial-fit photo: PCB sitting in the enclosure.
9. Final assembled sensor box, lid screwed on.
10. Pepper's-Ghost pyramid sitting on the iPad base.
11. The full installation on a desk, dark room, librarian floating.

Slack one photo per day so Andy sees momentum.

---

## 8. Literature-review hooks for the report (do in parallel)

While you're waiting for parts, draft the lit-review chapter with
these anchor references, each ~1 paragraph:

* **Custom PCB shields for Arduino**: Margolis (2020) *Arduino Cookbook*
  Ch. 16; Sparkfun *Designing a Shield* tutorial.
* **Smart-library IoT**: Pujar & Satyanarayana (2015), Wójcik (2016) —
  already in your earlier `LIT_REVIEW.md`.
* **Interactive Pepper's-Ghost installations**: Hong, Bae & Lippmann
  (2013) review of optical-illusion displays; Kim et al. (2012)
  *TeleHuman* for the "presence" framing.
* **Indoor environmental sensing for occupant comfort**: Wolkoff (2018),
  Chojer et al. (2020), Castell et al. (2017) — also already in the
  bibliography.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| PCB delayed by customs | Order DHL Express (£18) not standard post; alternative — solder a proto-board version this weekend |
| 3D print warps / fails | Print enclosure in two halves (less area on the bed); have laser-cut MDF backup ready |
| BME280 / MAX9814 out of stock at Pimoroni | Fallback: DHT22 (£4 at The Pi Hut) for temp; analog mic from your existing kit |
| MKR refuses to boot from PCB | Test with breadboard first, then transfer; keep the breadboard wired as a working reference |
| Andy wants to see progress mid-week | Send photo on Tue (EasyEDA screenshot), Thu (Fusion render), Sat (first print) |
