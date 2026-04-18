# SmoothDrive Hardware — Bill of Materials & Firmware Protocol

## Product Tiers

| Tier | SKU | MSRP | Hardware |
|------|-----|------|----------|
| Cam Kit | SD-CAM | $149 | Dash cam + Rear cam + HUD projector unit |
| Pro | SD-PRO | $199 | Cam Kit + OBD-II BLE dongle |
| Elite | SD-ELITE | $249 + $9.99/mo | Pro + Elite subscription (AI Concierge) |

---

## Tier 1: Cam Kit Unit

### Main Unit (Dash Cam + HUD Projector)

| Component | Part / Spec | Est. Cost (BOM) |
|-----------|-------------|-----------------|
| SoC | Rockchip RK3566 (quad A55, 2GB LPDDR4) or Ambarella H22 | $8–14 |
| Front camera sensor | Sony IMX415 (1/2.8", 8MP, 1440p30 / 1080p60) | $6–9 |
| Wide-angle lens | 140° DFOV, f/1.8, 6-element glass | $3–5 |
| HUD projector | DLP Pico projector module (Texas Instruments DLP2000, WVGA 854×480, 15 lumens) | $18–25 |
| Storage | microSD slot (up to 256GB), 32GB included | $3–5 |
| Wireless | WiFi 6 + BT 5.0 combo (Realtek RTL8852AE or similar) | $2–4 |
| GPS | u-blox M10 GNSS module (10Hz) | $3–5 |
| IMU | ICM-42688-P (6-axis, 32kHz) — g-force measurement for smooth score | $2–3 |
| Power | 5V 2A via USB-C; supercapacitor for safe shutdown on power loss | $2–3 |
| MCU (HUD controller) | STM32F4 — handles projector timing + keystone correction | $2–3 |
| Housing | Die-cast aluminum + PC, IP53 rated | $4–6 |
| Mount | Suction cup + adhesive base, ball-joint, quick-release | $2–3 |
| **Total BOM** | | **~$55–85** |

**Target COGS with packaging + assembly: ~$95–105**
**Retail: $149 → ~$44–54 gross margin on Tier 1**

### Rear Camera

| Component | Part / Spec | Est. Cost |
|-----------|-------------|-----------|
| Sensor | OV4689 or Sony IMX307 (1080p, WDR) | $4–6 |
| Lens | 160° DFOV rear view, f/2.0 | $2–3 |
| Cable | 5m micro-HDMI (thin profile, door-jamb routable) | $3–4 |
| Housing | Waterproof IP67, flush mount | $3–4 |
| Mount options | Internal suction / external license plate bracket | $2 |
| **Total BOM** | | **~$14–19** |

---

## Tier 2: OBD-II Dongle (Pro add-on)

### Hardware

| Component | Part / Spec | Est. Cost |
|-----------|-------------|-----------|
| MCU | STM32G0B1 or ESP32-C3 (BLE 5) | $1.50–3 |
| OBD transceiver | ELM327 clone IC (or STN2120 for better protocol support) | $1–3 |
| BLE module | Integrated in ESP32-C3 or Microchip RN4870 | $0–2 |
| OBD-II connector | Standard J1962 male plug | $1.50 |
| Voltage reg | 3.3V LDO, input 8–16V | $0.50 |
| LED indicators | Power (green) + Bluetooth (blue) + fault (amber) | $0.20 |
| Housing | Compact ABS, flush with dashboard | $1–2 |
| **Total BOM** | | **~$7–13** |

**Target COGS: ~$20–25. Retail add-on: $50 (Pro vs Cam Kit delta)**

### Supported OBD-II Protocols
- ISO 9141-2
- ISO 14230-4 (KWP2000)
- ISO 15765-4 CAN (11-bit / 29-bit, 250kbps / 500kbps)
- SAE J1850 PWM + VPW

### Key PIDs polled by app
| PID | Parameter |
|-----|-----------|
| 010C | Engine RPM |
| 010D | Vehicle speed |
| 0111 | Throttle position |
| 0105 | Coolant temperature |
| 012F | Fuel level |
| 0104 | Engine load |
| 010F | Intake air temp |
| 03 | Read stored DTCs |
| 04 | Clear DTCs |

---

## Firmware Architecture

### Main Cam Unit (Linux-based)

```
┌─────────────────────────────────────────┐
│  RK3566 SoC (Linux 5.15 + Buildroot)   │
├─────────┬───────────────┬───────────────┤
│ Camera  │ HUD Service   │ App Bridge    │
│ daemon  │ (smooth-line  │ (WebSocket    │
│(GStreamer│  renderer)   │  to phone)    │
│ pipeline)│              │              │
├─────────┴───────────────┴───────────────┤
│ GPS daemon (gpsd)  │  IMU daemon       │
│ u-blox M10 → NMEA  │  ICM-42688 → g's │
└─────────────────────────────────────────┘
```

**Camera pipeline (GStreamer):**
```
v4l2src → h264enc → rtsp sink (local WiFi stream to phone)
                  → MP4 mux → microSD (loop recording, 3-min segments)
```

**HUD rendering pipeline:**
- Phone app sends driving guidance data to unit via local WiFi WebSocket
- HUD service renders SVG path overlay using OpenVG / Cairo
- DLP module outputs via MIPI-DSI bridge (SN65DSI83 or similar)
- Frame rate: 30fps guidance overlay

**Build system:**
```bash
# Clone Buildroot, apply SmoothDrive config
git clone https://github.com/buildroot/buildroot
cd buildroot
make smoothdrive_rk3566_defconfig
make -j$(nproc)
# Flash output/images/sdcard.img to eMMC via Rockchip rkdeveloptool
```

### OBD-II Dongle Firmware (ESP32-C3 / Arduino)

```cpp
// Core loop
void loop() {
  if (ble.connected()) {
    String pid = ble.readCommand();      // Receive PID request from app
    String response = elm.query(pid);    // Forward to ELM327
    ble.send(response);                  // Return to app
  }
}
```

**BLE service UUIDs:**
- Service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Write char (app→dongle): `0000fff1-0000-1000-8000-00805f9b34fb`
- Notify char (dongle→app): `0000fff2-0000-1000-8000-00805f9b34fb`

**Flash toolchain:**
```bash
# Using PlatformIO
platformio run -e esp32c3 -t upload
# Or ESP-IDF
idf.py -p /dev/ttyUSB0 flash monitor
```

---

## Go-to-Market Strategy

### Phase 1 — Pre-launch (Months 1–3)
- Build waitlist via landing page (already live)
- Target 1,000 pre-orders at $99 early access (Cam Kit)
- Produce 50-unit engineering samples via Shenzhen CM (JLCPCB + Foxconn sub)
- Influencer seeding: 5 driving/car YouTubers, 10 dashcam reviewers

### Phase 2 — MVP Launch (Month 4–6)
- Cam Kit ships to early access list
- App available iOS + Android (Capacitor PWA → native builds)
- Support channels: AI Concierge handles L1, human team for L2
- Target: Amazon listing, own DTC site

### Phase 3 — Pro + Scale (Month 7–12)
- Pro tier launches with OBD-II dongle
- Fleet/insurance pilot: approach 2–3 mid-size insurers (usage-based premium discount)
- B2B: driver training schools, ride-share driver certification programs
- Elite subscription: activate Vapi AI Concierge at $9.99/mo

### Revenue model
| Stream | Description |
|--------|-------------|
| Hardware | One-time product sale |
| Elite SaaS | $9.99/mo AI concierge subscription |
| Insurance data licensing | Anonymized aggregate smooth-score data to insurers (opt-in) |
| Mechanic referral | AI Concierge recommends local shops via partner network (rev-share) |
| Fleet B2B | Per-seat annual license for commercial fleet coaching |

### Contract Manufacturing
- **PCB assembly:** JLCPCB (prototype) → GoerTek / BYD Electronic (scale)
- **Camera sensors:** Sourced via Shenzhen agent or direct Sony distributor
- **DLP module:** TI DLPA2005 eval kit → custom board at scale
- **Assembly + test:** CM in Shenzhen or Guadalajara (nearshore option)
- **FCC/CE certification:** Budget $25–40k, 3–4 months

### Funding narrative
- Seed ask: $2M (12-month runway)
  - $600k hardware NRE + tooling
  - $400k CM initial inventory (500 units)
  - $600k team (firmware eng, mobile eng, ops)
  - $400k marketing + launch
- KPIs at raise: 500 pre-orders, working prototype, FCC filing in progress
