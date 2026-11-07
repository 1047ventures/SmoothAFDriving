# Real-time driving context: what iOS allows with an in-car camera feed, and which edge devices could do the vision and send only events

Research date: 2026-11-06. About 19 tool calls. Many sources are forums, vendor pages or blogs, so the strength of each claim is flagged. Anything not backed by a fetched source is in Inferences or Gaps.

## Q1. iOS Wi-Fi: joining a dash cam's Wi-Fi while keeping cellular for internet, and the Personal Hotspot alternative

### Takeaway
An app can join a dash cam's no-internet Wi-Fi with NEHotspotConfiguration and still reach the internet, but only by binding its own internet traffic to cellular (Network framework `requiredInterfaceType = .cellular`). The OS "no internet / use cellular?" prompt cannot be suppressed by the app. Apple DTS confirmed that no API exists to mark a hotspot as "no internet". This is a well-known pain point for dash cam apps (Nexar, Viofo).

### Cited Findings
- Apple DTS (Matt Eaton, Dec 2021): the "no internet" prompt is a system prompt, and he knew of no workaround. His suggestion was to bind the app's internet-bound NWConnection traffic to the cellular interface with `requiredInterface`. The original poster used `NEHotspotConfiguration` with `joinOnce = true`, and DTS did not say whether joinOnce affects the prompt. A feature request to mark a hotspot as "not for Internet/Data" was filed, and no outcome is recorded. — [Apple Developer Forums 696320](https://developer.apple.com/forums/thread/696320)
- Developers report that when iOS sees a no-internet network and the user picks cellular, the app's link to the device on that Wi-Fi drops. Others confirm that `requiredInterfaceType` lets an app send traffic over cellular while staying on the hardware's Wi-Fi. — [Apple Forums 789103](https://developer.apple.com/forums/thread/789103); [Apple Forums 685191](https://developer.apple.com/forums/thread/685191); [Apple Forums 668318](https://developer.apple.com/forums/thread/668318)
- Nexar's support page for cellular data while on the camera's Wi-Fi tells users to check that cellular data is on for the app in Settings. Wi-Fi Assist and the Local Network permission both matter on iOS. — [Nexar help](https://help.getnexar.com/en/articles/8559739-unable-to-use-mobile-data-with-the-nexar-app)
- Dash cam forums report the same Wi-Fi vs. cellular conflict on iPhone. The usual fixes are toggling Wi-Fi Assist, and briefly airplane mode. — [Apple Discussions 254024787](https://discussions.apple.com/thread/254024787); [DashCamTalk A500 + iPhone](https://dashcamtalk.com/forum/threads/a500-wifi-iphone.43935/post-536865); [autoroamer fixes](https://www.autoroamer.com/posts/dashcam-wont-connect-to-phone-app-wifi-fix.html)
- Viofo publishes a guide to fixing a black live-view screen in its app, which shows that consumer dash cam live view over Wi-Fi is fragile. — [BlackboxMyCar](https://www.blackboxmycar.com/pages/how-to-fix-black-screen-on-the-viofo-dash-cam-apps-live-view-mode)

### Inferences
- Phone joins the camera's AP: this works, but the app has to handle the system prompt, the Local Network permission, and a user who might tap "use cellular". Auto-join by NEHotspotConfiguration needs the Hotspot Configuration entitlement and a user consent dialog on first join. That is standard API behaviour from training knowledge, not re-verified here.
- Camera joins the iPhone's Personal Hotspot: this avoids the no-internet problem, because the phone keeps cellular as its uplink and the camera becomes a client. Only cameras that can act as a Wi-Fi client support it; most consumer dash cams are AP-only, while the Nexar One has its own LTE. A custom edge device (Pi, Jetson, ESP32) can join a hotspot easily.
- Known Personal Hotspot quirks, from training knowledge rather than fetched sources: the hotspot can turn itself off when no client is connected; it needs a carrier plan that allows tethering; the client gets an address in the 172.20.10.x range; and the app has to find the device (mDNS/Bonjour or a fixed IP) with the Local Network permission. Verify these before relying on them.
- For an "events only" design, BLE avoids the Wi-Fi problem completely, and the bandwidth (a few hundred bytes per event) is trivial.

### Gaps
- I found no Apple doc or WWDC session from 2025–2026 that changes the no-internet-hotspot behaviour. The DTS answer is from 2021, so behaviour on iOS 26 is unconfirmed.
- I found no authoritative source on how iOS manages the Personal Hotspot when a client connects while the app is in the background, or on its auto-off timeout.

## Q2. Background: decoding RTSP/HTTP video plus CoreML/Vision with the screen off, and the battery and heat cost

### Takeaway
Doing video judging on the phone in the background is impractical. Background location mode keeps the process alive, but iOS invalidates VideoToolbox hardware decoder sessions when the app leaves the foreground, and GPU (Metal) work is not permitted in the background. Even in the foreground, sustained camera-rate ML on an iPhone heats it, throttles it and drains it, and a phone in a windshield mount runs hotter still. If the vision runs on the phone, it should be a foreground, screen-on, on-mains, reduced-fps mode at most.

### Cited Findings
- WebRTC (Chromium code review): "when the iOS application is not in the foreground, the hardware encoder and decoder become invalidated". Their fix was to stop encoding and decoding while the app is inactive and to reinitialize on return. — [WebRTC CL 1732953003](https://codereview.webrtc.org/1732953003)
- PJSIP saw the same behaviour: the VideoToolbox session is invalid after backgrounding, keeps throwing errors, and has to be reset. — [PJSIP ticket 2114](https://trac.pjsip.org/repos/ticket/2114)
- Linphone destroys the decoding context on error -12903 and recreates it, because after a resume the VideoToolbox filter could not decode any frame. — [Linphone mediastreamer2 videotoolbox.c](https://gitlab.linphone.org/BC/public/mediastreamer2/blob/a3ef55cdb23f59600fe62d86f927d15754f5effd/src/videofilters/videotoolbox.c)
- Apple has a Metal doc titled "Preparing your Metal app to run in the background". Its body did not render when fetched. The known rule is that GPU command buffers submitted from the background fail with `MTLCommandBufferError.notPermitted`. — [Apple doc](https://developer.apple.com/documentation/metal/preparing-your-metal-app-to-run-in-the-background) (title confirmed; body not retrieved)
- Sustained inference: on an iPhone 17 Pro, a 10-minute sustained test kept 67% of burst speed with Core ML on the Neural Engine, versus 38% on an MLX GPU path. iOS reports battery only in 1% steps. — [DEV Community, john-rocky](https://dev.to/john-rocky/iphone-on-device-llm-the-gpu-wins-the-sprint-the-neural-engine-wins-the-marathon-42lo) (this test used LLM decode, not vision)
- Other figures are weaker: one blog claims sustained Core ML on an iPhone 13 Pro can throttle in under 30 seconds, and another cites 15–30% battery per hour for background processing. A case study reports 35% drain in 30 minutes with thermal-aware gating versus 42% naive on an iPhone 14 Pro. All are unverified vendor or blog claims. — [omr.it.com thermal throttling](https://omr.it.com/blog/thermal-throttling-mobile-inference-design/); [markaicode](https://www.markaicode.com/battery-optimization-mobile-ai-apps/)
- Users report the iPhone 16 Pro and 17 Pro overheating during camera use (iOS 26.2). These are anecdotes, but they are relevant because a dash mount in sun is worse. — [Apple Discussions 256243832](https://discussions.apple.com/thread/256243832); [itechify iPhone 17 Pro](https://itechify.com/2026/02/17/iphone-17-pro-overheating/)

### Inferences
- The background location mode the app already has keeps it running for GPS. It does not exempt the app from the decoder and GPU limits. CPU-only decode (software H.264) plus CPU or Neural Engine inference might technically run in the background. Whether Core ML's Neural Engine path is permitted in the background is unconfirmed, and CPU decode of 1080p30 is very costly. Apple may also treat a long-running background video pipeline as abuse of the location mode in App Review.
- A practical on-phone mode would be foreground with the screen on (CarPlay-style or a mounted phone), ~5–10 fps of detection at reduced resolution, `computeUnits = .cpuAndNeuralEngine`, the phone charging, and a ladder that steps down on `ProcessInfo.thermalState`. Even so, a phone charging in a windshield mount in sun is the worst thermal case.
- An "events only from an edge device" design moves all of this off the phone. The phone only needs BLE or a tiny socket, which fits iOS background rules far better. Core Bluetooth has a background mode; that is from training knowledge and not re-verified here.

### Gaps
- I found no rigorous measured figure for battery %/hour and thermal throttling of YOLO-class Vision/Core ML on a camera or video stream for iPhone 15/16/17. On-device profiling with Instruments (Energy, Thermal) is needed.
- I found no Apple text confirming whether ANE (Neural Engine) inference is allowed in the background.

## Q3. Edge devices that run vision and send compact events

### Takeaway
The strongest options are a Raspberry Pi 5 with the Hailo-8L AI Kit (cheap, ~30 fps YOLOv8, ~11 W, but it needs a car camera, power and cooling) and a comma 3X/4 running openpilot. openpilot already outputs lead distance, relative speed, lane lines, road edges and lane-change state at 20 Hz, through an open message schema that a third party can subscribe to. Jetson Orin Nano is more powerful but needs more power and heat headroom. OAK-D needs a host. Coral is effectively wound down. ESP32 class is too weak for vehicle and lane work. Mobileye's aftermarket unit is discontinued.

### Cited Findings

**comma 3X / comma four (openpilot)**
- openpilot's `modelV2` message (struct `ModelDataV2`) carries `laneLines` with `laneLineProbs`, `roadEdges`, `leadsV3` (a list of `LeadDataV3`), `meta` and a `confidence` class (red/yellow/green). — [openpilot log.capnp (master)](https://raw.githubusercontent.com/commaai/openpilot/master/openpilot/cereal/log.capnp)
- `LeadDataV3` has `prob` ("probability that car is your lead at time t"), `probTime`, `t`, `x`/`y` relative position in device frame with std devs, `v` (absolute speed) and `a`. `MetaData` has `hardBrakePredicted`, `laneChangeState`, `laneChangeDirection`, `desireState`, and `disengagePredictions`, which include brake ≥3/4/5 m/s² probabilities. — [openpilot log.capnp](https://raw.githubusercontent.com/commaai/openpilot/master/openpilot/cereal/log.capnp)
- `radarState.leadOne` gives `dRel` (m from the front bumper), `vRel` (m/s relative longitudinal speed), `aRel` and `modelProb` (vision lead probability). That is enough for time headway, computed as dRel / ego speed. — [openpilot log.capnp](https://raw.githubusercontent.com/commaai/openpilot/master/openpilot/cereal/log.capnp)
- Publish rates: `modelV2` 20 Hz, `radarState` 20 Hz, `carState` 100 Hz, `driverMonitoringState` 20 Hz, `onroadEvents` 1 Hz. — [openpilot services.py](https://raw.githubusercontent.com/commaai/openpilot/master/openpilot/cereal/services.py)
- Messaging uses cereal pub/sub, read in Python with `messaging.SubMaster([...])`. It has two backends: msgq (local shared memory) and ZMQ (networked). — [commaai/cereal README](https://www.github.com/commaai/cereal); [openpilot 101](https://github.com/barbinbrad/openpilot-101)
- A `bridge` process on the device forwards messages over the network. Tools such as Cabana connect with `--zmq <device-ip>` while the laptop and device are on the same network. — [CarrotPilot Cabana guide](https://g4iwnl.gitbook.io/carrotpilot/developers/cabana)
- comma 3X and comma four both use a Snapdragon 845, per one forum user; another says the four's main gain is better thermals. Neither is an official spec. comma has reportedly said the 3X will be supported for another year. — [Rivian Forums](https://rivianforums.com/forum/threads/comma-ai-owner-demo-drive-connect-thread.54059/post-922670); [Rivian Forums post](https://rivianforums.com/forum/goto/post?id=922760)

**Raspberry Pi 5 + Hailo-8L (AI Kit / AI HAT+ 13 TOPS)**
- The kit is "13 TOPS for $70" (2024 review). — [Jeff Geerling](https://jeffgeerling.com/blog/2024/testing-raspberry-pis-ai-kit-13-tops-70)
- A 2026 test on a Pi 5 8GB: YOLOv8n at 1080p input runs at ~30 fps. Camera preprocessing (libcamera/rpicam) takes ~20 ms a frame and is the bottleneck. The system draws 8.5 W idle and 11.2 W at sustained 30 fps, and throttles after ~8 minutes at 11 W without an active cooler. — [specpicks 2026](https://specpicks.com/reviews/raspberry-pi-5-ai-hat-real-time-vision-projects-2026) (blog, single test)
- Seeed measured YOLOv8 at 640×640 on a CM4-based reComputer with Hailo-8L: 0.75 fps on CPU vs 29.5 fps accelerated. — [Seeed wiki](https://wiki.seeedstudio.com/ja/yolov8_object_detection_on_recomputer_r1000_with_hailo_8l/)
- Other sources: YOLOv8s at ~25–35 fps at 640 on Pi 5 + Hailo-8L, and the full Hailo-8 (26 TOPS) module draws 2.5 W typical and 8.65 W max. — [mustafa.net](https://mustafa.net/tools/ai/hailo-8l/); [Waveshare Hailo-8](https://www.waveshare.com/hailo-8-acce-a.htm)

**Luxonis OAK-D / OAK 4**
- The OAK-D Lite costs $269. It draws 0.6 W standby, ~4 W in demo and 4.5 W max, with possible 2 W spikes while running the NN or encoder. — [Luxonis store](https://checkout.luxonis.com/products/oak-d-lite-1); [OAK-D Lite spec sheet](https://cdn.shopify.com/s/files/1/0630/8950/8583/files/OAK-D-Lite_Spec_Sheet.pdf)
- It needs a USB host to receive results; for example, Tiny-YOLO spatial detection ran at 28 fps on a Pi 5 host, an anecdotal forum report. — [zbotic review](https://zbotic.in/oak-d-lite-ai-camera-depth-ai-on-edge-device-review/); [Luxonis forum](https://discuss.luxonis.com/d/3273-python-example-put-oak-d-lite-into-low-power-state/3)
- The standalone OAK 4 line uses a Qualcomm QCS8550 with up to 52 TOPS. The OAK 4 S starts at $749. — [CNX Software Dec 2025](https://www.cnx-software.com/2025/12/15/luxonis-oak4-standalone-ai-vision-camera-features-qualcomm-qcs8550-soc-with-up-to-52-tops-performance/)

**NVIDIA Jetson Orin Nano Super**
- The developer kit costs $249, half its $499 launch price. SparkFun lists it as out of stock, with possible tariff-driven price changes. — [CNX Software](https://cnx-software.com/2024/12/18/249-nvidia-jetson-orin-nano-super-developer-kit-targets-generative-ai-applications-at-the-edge/); [SparkFun](https://www.sparkfun.com:443/products/22098)
- Power modes are 7 W, 15 W, 25 W and MAXN SUPER (uncapped) with JetPack 6.2. Memory bandwidth rises from 68 to 102 GB/s. — [edge-ai-vision / NVIDIA](https://www.edge-ai-vision.com/2025/02/make-your-existing-nvidia-jetson-orin-devices-faster-with-super-mode/); [JetsonHacks](https://jetsonhacks.com/2024/12/17/jetson-orin-nano-super-developer-kit/)
- YOLOv8 fps claims are unverified: 200+ fps for v8n at 640, and 30–60+ fps for "YOLO-class". — [pamfinds](https://pamfinds.pages.dev/ai-edge/jetson-orin-nano-8gb/); [ThinkRobotics](https://thinkrobotics.com/blogs/product-reviews-buying-guides/nvidia-jetson-orin-nano-super-developer-kit-review-is-it-the-best-edge-ai-board-in-2025)

**Google Coral**
- The hardware is being wound down: Mouser shows a module "Phased out", Core Electronics lists the USB Accelerator as discontinued, and SparkFun retired the SMT module. The GitHub repos were reportedly archived between 2025 and 2026, and coral.ai now points to "Coral NPU". The Edge TPU is still supported in Frigate. — [Mouser](https://www.mouser.co.uk/new/google-coral/coral-accelerator-mod-Edge-TPU); [Core Electronics](https://core-electronics.com.au/google-coral-usb-accelerator.html.md); [SparkFun](https://www.sparkfun.com/coral-accelerator-module-surface-mount-with-edge-tpu.html); [aiwiki Edge TPU](https://aiwiki.ai/wiki/edge_tpu) (aggregator)

**ESP32-CAM class**
- Plumerai People Detection runs on an ESP32-S3 at 240 MHz on one core: 303 ms latency (3.3 fps), 166 KiB RAM. It is commercially licensed. — [Plumerai blog](https://blog.plumerai.com/2023/03/espressif_esp32-s3_support/)
- Espressif's open tflite-micro person detection manages only ~1–2 fps on the ESP32-S2. — [Espressif component](https://components.espressif.com/components/espressif/esp-tflite-micro/versions/1.3.3~1/examples/person_detection)

**Mobileye 8 Connect (aftermarket)**
- Mobileye said in March 2024 that it would wind down its aftermarket solutions unit. — [BusinessWire via mammothtimes](https://business.mammothtimes.com/mammothtimes/article/bizwire-2024-3-18-mobileye-to-wind-down-aftermarket-solutions-unit)
- The unit had a CAN output protocol (v1.2), its only data interface; no developer API was found. The PDF did not parse. Price was tied to insurer and fleet pilots, for example a requirement to stay with AmGUARD for 36 months. — [Mobileye CAN protocol PDF](https://static.mobileye.com/website/us/corporate/files/Mobileye_8_CAN_Standard_Outpot_Protocol_V1.2.pdf); [Protective Insurance flyer](https://www.protectiveinsurance.com/docs/librariesprovider3/vrn/mobileye-vrn-flyer-pi2002001.pdf); [Mobileye 8 Connect AU](https://ims.mobileye.com/fleets/au/products/mobileye-8-connect/)

**Nexar**
- The Nexar One has built-in LTE ("no WiFi needed"). Live alerts need Nexar Connect at $9.99/month. — [Nexar One](https://www.getnexar.com/EN-US/products/nexar-one)
- Collision detection is cloud-side: cams send motion data to cloud algorithms, which then request more data. The phone app uses on-device AI to build the CityStream map. No third-party event API for consumers was found. — [Nexar Collision Insights](https://data.getnexar.com/product/collision-insights); [CityStream PR](https://prnewswire.com/news-releases/nexar-launches-citystream-to-provide-minute-by-minute-visibility-of-entire-cities-621863773.html)

### Inferences
- **The comma path is lowest effort for a third party, if the driver already owns one.** A small script on the device subscribes to `modelV2` and `radarState` and turns them into events: headway < 1 s (dRel / vEgo), a lead whose `y` jumps across lanes into the ego lane (cut-in), `laneChangeState` transitions (lane change), and `hardBrakePredicted`. It sends them over the comma's Wi-Fi to the phone, or over the ZMQ bridge with the phone on the same network. Caveats: that needs custom code on a device made for driver assist, users may not want to modify it, and the comma 3X/4 retails for roughly $1k+ (price not verified this session). No traffic-light or stop-sign classifier output was found in `modelV2`, so "ran a stop" is not directly available.
- **A Pi 5 + Hailo-8L build is the cheapest custom option.** Roughly $80 for the Pi 5, $70 for the kit, and a camera plus 12 V→5 V/5 A converter and active cooler, totalling about $150–200 (component prices are from training knowledge except the $70 kit). It runs YOLOv8 vehicles and traffic lights (COCO includes car, truck, traffic light and stop sign) at ~30 fps and ~11 W. Lane detection needs a separate model, such as UFLD or the Hailo model zoo lane models (not verified). In-cabin heat is the main risk: it throttles after ~8 minutes without a cooler, before any sun soak. Events reach the phone over BLE (the Pi 5 has BLE 5.0) or by the Pi joining the iPhone's Personal Hotspot.
- The Jetson Orin Nano is overkill in power (7–25 W) for single-camera YOLO, but it is the most capable for multi-model work (lanes + objects + depth).
- OAK-D needs a host, such as a Pi Zero 2W or Pi 5. The OAK 4 S is standalone but costs $749+.
- ESP32 class can't do vehicle detection plus lanes at useful rates (~3 fps people detection). It only works as a BLE relay or raw-frame sender.
- Detection latency is ~33–50 ms/frame at 20–30 fps on Hailo or comma, and BLE notification latency is tens of ms. Both are well inside what a post-drive score or a ~1 s live coaching cue needs. Real-time hard-braking feedback is not needed for scoring.

### Gaps
- Official comma 3X and comma four price and power draw were not retrieved this session; check comma.ai/shop.
- No confirmed Hailo model-zoo entries for lane detection or traffic-light state (red/green) were retrieved.
- The exact current ZMQ env flag and bridge usage for openpilot was not confirmed from source.
- No measured cabin-heat or sun-soak data for a Pi 5, Jetson or OAK in a parked car was found.
- The Mobileye CAN message contents could not be parsed from the PDF.

## Q4. Existing products and open-source projects doing "dash cam + driving score"

### Takeaway
Fleet AI dash cams (Samsara, Nauto, Motive and others) already compute camera-based events for scores: following distance, rolling stops and lane departure. They use speed, a vanishing-point calibration and map data, and they are subscription and fleet products with no consumer phone API. Nexar is consumer but cloud-centred. No open-source "openpilot-based driving score" project was found in this session.

### Cited Findings
- Samsara AI dash cams combine distance estimation with current speed to detect tailgating in real time, and each following-distance detection feeds the driver safety score. The default event fires at > 45 mph with ≤ 1 s following distance for ≥ 30 s, and thresholds are configurable. — [Samsara UK blog](https://samsara.com/uk/blog/behind-the-lens-5-things-ai-dash-cams-can-spot-that-drivers-might-miss); [Samsara KB](https://kb.samsara.com/hc/articles/360043619011)
- Samsara's rolling-stop detection uses the dash cam's stop-sign detection plus map data, with a speed threshold of 5 mph (default), 10 or 15 mph. — [Samsara KB](https://kb.samsara.com/hc/articles/360029629972)
- Samsara needs an average of 30 minutes of drive time per vehicle to calibrate the camera and vanishing point after AI Event Detection is enabled. — [Samsara KB](https://kb.samsara.com/hc/articles/360043619011)
- Samsara also detects lane departure. Its AI dash cam launch coverage stresses on-camera computer vision for collision prevention, with OTA model updates. — [CCJ](https://www.ccjdigital.com/samsara-adds-camera-vision-to-catch-distracted-driving-tailgating/); [FleetOwner](https://www.fleetowner.com/technology/article/21703477/samsaras-new-ai-embedded-dashcam-sees-more-promises-ota-updates); [Government Fleet](https://www.government-fleet.com/news/samsara-debuts-ai-powered-dash-cam-for-collision-prevention)
- Nexar's App Store app uses AI and phone sensors to detect hard brakes, sharp turns and harsh accelerations. Collision detection runs in the cloud from motion data. — [App Store](https://apps.apple.com/app/id6478313031); [Nexar Collision Insights](https://data.getnexar.com/product/collision-insights)
- Mobileye 8 Connect, discontinued in 2024, was a retrofit camera with display and GPS that gave FCW and lane warnings. It was sold through fleets and insurers. — [Mobileye 8 Connect](https://ims.mobileye.com/fleets/au/products/mobileye-8-connect/); [mammothtimes/BusinessWire](https://business.mammothtimes.com/mammothtimes/article/bizwire-2024-3-18-mobileye-to-wind-down-aftermarket-solutions-unit)

### Inferences
- Samsara's thresholds are a useful default rubric for a consumer app: headway ≤ 1 s sustained above ~45 mph, and rolling stop ≤ 5 mph at a mapped stop sign. The rolling-stop approach (detector + map) suggests "ran a stop" could be done on the phone side from GPS plus OSM stop-sign data, without any camera. A camera mainly confirms it.
- The vanishing-point calibration Samsara needs (~30 minutes of driving) would apply to any DIY camera too, and it costs first-run friction.

### Gaps
- Nauto, Motive, Lytx and Zendrive camera features were not researched this session; the search returned only Samsara. Zendrive is phone-sensor only, per training knowledge, and was acquired by Credit Karma in 2024 (unverified here).
- No Hailo "dashcam demo" with driving scoring and no open-source openpilot-log scoring project were found. Community tools like the MoreTorque rlogs dataset on Hugging Face exist for openpilot logs, but they are not scoring tools. — [MoreTorque/rlogs](https://huggingface.co/datasets/MoreTorque/rlogs)
