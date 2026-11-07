# Post-drive computer-vision pipeline for dash cam context: approaches, accuracy, cost, sync, and score correction

Research date: 2026-11-06. All prices were read from official pricing pages on that date unless noted otherwise. Workload assumed throughout: 10 clips × 15 s per drive, 2 drives/day, 30 days, which is **600 clips and 9,000 s of video per user per month**. That figure is for one camera channel; sending front and rear doubles it.

## 1. Approaches and published accuracy: classic CV vs multimodal LLMs

### Takeaway
Published results favour a hybrid. Off-the-shelf multimodal LLMs, used zero-shot, are poor at the safety-critical part: spotting the event and when it happened in dashcam video. Nexar's benchmark found Gemini 2.0 Flash detected about 15% of collisions and 4% of near-collisions. AccidentBench reports about 18% accuracy for frontier models on its hardest tasks. LLMs are good at scene attributes such as weather and lighting. Classic CV (detector + tracker + lane model) is the better fit for measurable things like headway and cut-in. One cut-in classifier built on BDD100K reached about 96% accuracy. An LLM is better used as a cheap second opinion on a clip whose moment has already been located, not as the detector.

### Cited Findings
**Multimodal LLMs on driving and dashcam video**
- Nexar (Feb 13, 2025) benchmarked Gemini-2.0-flash, GPT-4o, Claude 3.5 Sonnet, Llama-3.2 and Qwen2-7B/72B on its dashcam incident videos. Models returned structured JSON over a seven-category taxonomy (lighting, weather, road condition, zone, vehicle density, main event of collision / near-collision / normal), scored by macro F1. — [Nexar / Empiric Earth blog](https://empiricearth.com/insights/benchmarking-ai-for-dashcam-video-understanding-insights-from-nexars-large-scale-incident-dataset)
- Same source, event results:
  - Gemini-2.0-flash detected about 15% of collisions at 69% precision, and about 4% of near-collisions at 75% precision.
  - GPT-4o detected about 0.6% of near-collisions.
  - Most models had near-zero recall on the main event and labelled accident scenes as normal driving.
  - Lighting and weather were near-perfect for clear, daylight and rain scenes.
  - Rare conditions defaulted to the majority label, including some day vs night classifications. — [Nexar / Empiric Earth blog](https://empiricearth.com/insights/benchmarking-ai-for-dashcam-video-understanding-insights-from-nexars-large-scale-incident-dataset)
- Nexar also noted that GPT-4o and Claude were fed frames at fixed intervals (e.g. 1 FPS), which "may miss momentary events". A later leaderboard update added Gemini 2.5 Pro and said it "breaks ahead". I could not retrieve its figures. — [Nexar / Empiric Earth blog](https://empiricearth.com/insights/benchmarking-ai-for-dashcam-video-understanding-insights-from-nexars-large-scale-incident-dataset)
- NVIDIA's VLM-AutoDrive (arXiv 2603.18178, 2026) fine-tuned Cosmos-Reason1 7B on Nexar dashcam video:
  - Collision F1 went from 0.00 zero-shot to 0.69 after fine-tuning.
  - Overall accuracy went from 35.35% to 77.27%.
  - The base model had near-zero collision recall zero-shot. — [arXiv 2603.18178](https://arxiv.org/abs/2603.18178)
- AccidentBench (arXiv 2509.26636) has about 2,000 accident videos and over 19,000 human-annotated QA pairs (temporal, spatial, intent). Gemini-2.5 Pro and GPT-5 reach only "about 18% accuracy on the hardest tasks and longest videos". — [arXiv 2509.26636](https://arxiv.org/abs/2509.26636)
- DriveBench (ICCV 2025, arXiv 2501.04003) has 19,200 frames, 20,498 QA pairs, 12 VLMs, and 17 settings covering clean, corrupted and text-only input. VLMs often give plausible answers from general knowledge or text cues rather than the image, especially when the image is degraded or missing. — [arXiv 2501.04003](https://arxiv.org/abs/2501.04003); [GitHub](https://github.com/worldbench/drivebench)
- General video QA is a different picture. On Video-MME (CVPR 2025), Gemini 1.5 Pro scored 75% and GPT-4o 71.9%, so general video QA is far easier than safety-event detection. — [Video-MME paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Fu_Video-MME_The_First-Ever_Comprehensive_Evaluation_Benchmark_of_Multi-modal_LLMs_in_CVPR_2025_paper.pdf)

**Classic CV**
- YOLOPv2 on BDD100K (self-reported): drivable-area mIoU 93.2% (YOLOP 91.5%, HybridNets 90.5%), lane-line accuracy 87.3%, lane-line IoU 27.2% (below HybridNets), 91 FPS on a V100 (YOLOP 49 FPS). — [arXiv 2208.11434](https://arxiv.org/abs/2208.11434v1)
- Cut-in prediction from a monocular camera (Nalçakan & Baştanlar, 2022): YOLOv4 + DeepSORT + LSTM. No public cut-in benchmark existed, so they labelled 875 BDD100K clips themselves. They report 0.9585 accuracy for cut-in vs lane-pass. They did not estimate headway. — [arXiv 2203.10707](https://ar5iv.labs.arxiv.org/html/2203.10707)
- An open-source prototype uses YOLOv8 + SORT to estimate vehicle speed and time-to-collision from ego speed. It is calibrated by hand on Indian road video. — [GitHub MENT0Z/Vehicle-Cut-in-Detection](https://gh.r-mj.com/MENT0Z/Vehicle-Cut-in-Detection)
- Fleet products measure headway as a time and alert on thresholds:
  - Samsara's Following Distance default is 0.7 s, configurable from 0.5 to 1.5 s. Another Samsara article describes an event at >35 mph, under 1.0 s, held for at least 15 s. The two Samsara docs conflict. — [Samsara KB](https://kb.samsara.com/hc/articles/360043193612); [Samsara guide](https://samsara.com/guides/following-distance)
  - Lytx's 2020 press release counts "Following Distance Under 2 Seconds" as a top risky behaviour. — [Lytx press release](https://www.lytx.com/en-us/news-events/press-release/2020/summer-2020-most-common-risky-behavior)
  - Mobileye sells headway monitoring warnings for fleets. — [Mobileye HMW](https://ims.mobileye.com/fleets/uk/technology/headway-monitoring-warning/)

### Inferences
- Recommended split:
  - The phone's own flag (hard brake or swerve at time t) already says when it happened, which removes the temporal-localisation problem where VLMs are weakest.
  - Classic CV handles the numbers: track the lead vehicle with YOLO + ByteTrack. Time headway ≈ distance / ego GPS speed. Monocular distance can come from bbox height with known camera height and pitch (flat-road assumption), or bbox width with a typical car width of about 1.8 m.
  - Cut-in = a new track entering the ego-lane polygon (from YOLOPv2 or UFLD) within about 2 s before the brake.
  - A VLM answers yes/no questions with a confidence: was the light red, was there a signal, was there a stop sign.
- Because the LLM gets a short window centred on a known moment, our task is easier than the Nexar and AccidentBench settings, which require finding the event in long video. Those accuracy figures are therefore a pessimistic bound. This is an inference, not measured.
- Turn-signal use by the driver's own car cannot be seen on a front camera, except perhaps as a dashboard reflection. It needs OBD or CAN data, or audio of the indicator click. Rear-camera tailgater detection is the same detection + bbox-size problem as headway, run on the rear channel.

### Gaps
- I found no published benchmark of VLMs specifically on red-light/stop-sign compliance, cut-in, or turn-signal use from consumer dashcam video.
- I did not retrieve per-model F1 tables from the Nexar leaderboard, including Gemini 2.5 Pro and later. I also did not get CLRNet/UFLD CULane night-split F1.
- There is no published accuracy figure for monocular bbox-based headway error on consumer dashcams. Expect error to grow with distance and with pitch changes. That expectation is unsourced.
- I found no public dataset labelled with time headway per event.

## 2. Cost per clip and the worked estimate (prices as of 2026-11-06)

### Takeaway
At 600 single-channel clips per user per month:
- **Gemini Flash-Lite or Claude Haiku 5.5:** about $0.30–$1.20 per user per month.
- **Gemini Flash or a self-hosted YOLO batch on a serverless T4:** about $1.5–$3.
- **Rekognition:** about $9–15. It still doesn't answer the headway or cut-in questions.
- **Frontier models (Sonnet, Gemini Pro) on every clip:** about $13–25.

Batch APIs halve the LLM numbers. Gemini Flash's price doubles on Jan 1, 2027.

### Cited Findings
**Gemini API** — [Google AI Studio pricing](https://aistudio.google.com/docs/pricing); [Video understanding docs](https://aistudio.google.com/docs/video-understanding)

Video tokenisation:
- Default sampling is 1 fps.
- A frame costs 66 tokens at `media_resolution` low and 258 tokens otherwise. Audio adds 32 tokens/s.
- That works out to about 100 tokens/s at low resolution and about 300 tokens/s at high.
- The `fps` (e.g. 0.5) and `start_offset`/`end_offset` clipping settings work only in "static" mode.

Prices per 1M tokens (input text/image/video, then output):

| Model | Input | Output | Notes |
|---|---|---|---|
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | |
| Gemini 3.8 Flash / 3.6 Flash | $0.75 | $3.75 | Until Dec 31, 2026; $1.50 / $7.50 from Jan 1, 2027 |
| Gemini 3.1 Pro Preview | $2.00 | $12.00 | Prompts ≤200k tokens |

- The Batch API costs 50% less.
- Gemini 2.5 Flash / Flash-Lite are deprecated. From Dec 1, 2026, 2.5 Flash requests route to 3.5 Flash-Lite.

**Claude API** — [Claude pricing](https://www.claude.com/pricing); [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Image tokens = ⌈w/28⌉ × ⌈h/28⌉.
- High-resolution tier (Claude 4.7 and later): long edge up to 2,576 px and up to 4,784 tokens. A 1920×1080 frame costs 2,691 tokens on that tier, or 1,560 on the standard tier. The docs advise downsampling to control cost.
- Prices per 1M tokens (input / output): Haiku 5.5 $0.10 / $0.50 (prompts ≤100K), Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20. Batch saves 50%.
- No native video input; the docs list images only, so clips must be sent as sampled frames.

**OpenAI API** — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Prices per 1M tokens (input / output): gpt-5.4-nano $0.20 / $1.25, gpt-5.4-mini $0.75 / $4.50, gpt-6.1-sol $2.00 / $10.00, gpt-5.5 $5.00 / $30.00. Batch is about half.
- The page does not document how image inputs are tokenised.

**AWS Rekognition** — [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- Stored-video Label Detection is $0.10/min.
- Image DetectLabels is $0.001/image for the first 1M images per month.

**Modal serverless GPU** — [Modal pricing](https://modal.com/pricing)
- Per second: T4 $0.000164 (about $0.59/hr), L4 $0.000222, A10 $0.000306, A100-80GB $0.000694, H100 $0.001097.
- Containers stay up and bill for 60 s after the last input by default. The Starter plan includes $30/month in free credits.

### Worked estimate (my arithmetic on the prices above; per user per month = 600 clips)
Per-clip assumptions: 15 s of video, a ~500-token text prompt, and ~300 tokens of JSON out. "Thinking" tokens are not counted except for Pro.

| Option | Tokens or compute per clip | $/clip | $/user/month (600 clips) | Batch (–50%) |
|---|---|---|---|---|
| Gemini 3.1 Flash-Lite, 1 fps, low res | ~1,500 video + 500 = 2,000 in / 300 out | ~$0.00095 | **~$0.57** | ~$0.29 |
| Gemini 3.1 Flash-Lite, 1 fps, default res | ~4,350 + 500 in / 300 out | ~$0.0017 | ~$1.0 | ~$0.5 |
| Gemini 3.8 Flash, 1 fps, default res (2026 price) | ~4,850 in / 300 out | ~$0.0048 | ~$2.9 (≈$5.8 from 2027) | ~$1.45 |
| Gemini 3.1 Flash-Lite, 4 fps, default res (for fast cut-ins) | ~15,500 + 500 in / 300 out | ~$0.0045 | ~$2.7 | ~$1.35 |
| Gemini 3.1 Pro, 1 fps, default res, ~1,000 thinking/output tokens | ~4,850 in / 1,000 out | ~$0.022 | ~$13 | ~$6.5 |
| Claude Haiku 5.5, 15 frames at 1280×720 (1,196 tok/frame) | ~17,900 + 500 in / 300 out | ~$0.0020 | **~$1.2** | ~$0.6 |
| Claude Haiku 5.5, 15 frames at 640×360 (299 tok/frame) | ~5,000 in / 300 out | ~$0.00065 | ~$0.39 | ~$0.2 |
| Claude Sonnet 5.5, 15 frames at 1280×720 | ~18,400 in / 300 out | ~$0.040 | ~$24 | ~$12 |
| AWS Rekognition Video label detection (0.25 min) | — | ~$0.025 | ~$15 | — |
| AWS Rekognition Image DetectLabels, 15 frames | — | ~$0.015 | ~$9 | — |
| Self-hosted YOLO + tracker + YOLOPv2 on a Modal T4, batched per drive (10 clips ≈150 s GPU + 60 s idle tail + ~20 s cold start ≈ 230 s) | ~$0.038/drive | ~$0.004 | ~$2.3 | — |

- Front + rear doubles every row.
- Hybrid estimate: run self-hosted CV on every clip and send only the ambiguous ~20–30% to Haiku or Flash-Lite. That should land around $2.5–3 per user per month, almost all of it GPU idle and cold-start overhead.
- Running YOLO on-device, on the phone, would cost $0 in cloud spend.

### Inferences
- At this volume a single-GPU serverless setup is dominated by cold-start and idle-tail billing. Batching several users' drives into one container run, or one nightly batch, cuts the self-host cost sharply.
- Rekognition is the worst value. It costs the most and returns generic labels and boxes, not headway, lane position or signal state.
- Lock in model IDs. Gemini is retiring 2.5 models and repricing Flash in Jan 2027, so cost projections can move about 2× with no code change.

### Gaps
- The YOLO-on-T4 throughput is my estimate. YOLOPv2's only published figure is 91 FPS on a V100. I did not benchmark T4 or L4 throughput.
- I did not check whether Rekognition Video bills a whole-minute minimum for a 15 s clip.
- Not found: OpenAI image-token accounting, and RunPod / Replicate per-second GPU prices. I did not fetch either.
- Gemini Flash-Lite and Haiku accuracy on these specific questions is unmeasured. The cheapest tier may be too weak, which needs a pilot on a labelled sample.

## 3. Time sync: aligning dash cam video with phone GPS and motion

### Takeaway
Do not trust the dash cam's clock. Use embedded GPS where the camera writes it: ExifTool decodes about 27 streaming-GPS formats. Even that track can be offset from the video. Then refine by cross-correlating the camera's own motion with the phone's: the G-sensor track if exposed, or optical-flow ego-motion otherwise, against the phone's accelerometer or GPS speed. Take the lag at the correlation peak.

### Cited Findings
- Phil Harvey (ExifTool's author) says every cam stores GPS differently. ExifTool extracts 27 streaming-GPS formats from video with `exiftool -ee`, e.g. `exiftool -p gpx.fmt -ee FILE > out.gpx`. — [ExifTool forum](https://exiftool.org/forum/index.php?msg=60362)
- BlackVue units write pseudo-NMEA per MP4. One DR900X user found the GPS track time not synced with the video time, and suggested a variable delay of 1–8 minutes in the NMEA data. Another user saw odd, non-whole-hour offsets. — [ExifTool forum (BlackVue)](https://exiftool.org/forum/index.php?msg=76383); [Mapillary forum](https://forum.mapillary.com/t/dr900x-tracks-not-recognized-by-mapillary-tools/4598)
- Cross-correlation of accelerometer and video streams has been used to sync face and dash cameras with vehicle telemetry; the paper also notes drift between recordings made without a shared clock. — [arXiv 1510.06113](https://web3.arxiv.org/pdf/1510.06113v1)
- Sevivi aligns two acceleration streams by the peak of their cross-correlation and recommends a sharp shake or tap as an easy spike to match. — [Sevivi docs](https://sevivi.readthedocs.io/en/latest/background.html)
- Other sync methods:
  - ETH `time_autosync` estimates the camera–IMU offset online with a Kalman filter. — [GitHub ethz-asl/time_autosync](https://github.com/ethz-asl/time_autosync)
  - BMAR aligns devices offline using barometric and motion signals. — [arXiv 2501.16015](https://arxiv.org/pdf/2501.16015)
  - A patent describes frame-accurate sync of mobile cameras via accelerometer cross-correlation. — [US patent 12170755](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12170755)

### Inferences
- Practical recipe:
  1. Coarse alignment from file timestamps or embedded GPS.
  2. Fine alignment by cross-correlating phone GPS speed (1 Hz) with camera GPS speed. If there is no camera GPS, use phone longitudinal acceleration against the video's optical-flow forward motion or G-sensor.
  3. Confirm with the flagged hard brake itself, which is a sharp, shared spike.
- Re-estimate the offset per drive, since drift accumulates between clock syncs. For a 15 s clip around a 1 Hz GPS event, ±0.5 s is probably good enough; headway at the moment of braking needs about 0.2 s. These tolerances are an inference.

### Gaps
- I found no source on consumer dash cam G-sensor sampling rates or RTC drift rates (ppm), and no Novatek- or GPMF-specific documentation; I did not fetch any.

## 4. Datasets, models, and false-positive risks (night, rain, glare)

### Takeaway
Most building blocks train on BDD100K: cut-in labels derived from it, YOLOP/YOLOPv2 lanes and drivable area, plus detection. For event detection there are dashcam incident sets (Nexar, AccidentBench) and VLM reliability tests (DriveBench). The documented weak points are degraded or corrupted images and rare conditions. VLMs drift toward plausible but ungrounded answers and toward majority labels, which is exactly the false-positive and false-forgiveness risk at night or in glare.

### Cited Findings
- BDD100K front-camera clips were the source for an 875-clip hand-labelled cut-in set. — [arXiv 2203.10707](https://ar5iv.labs.arxiv.org/html/2203.10707)
- YOLOPv2 and YOLOP are trained and evaluated on BDD100K. — [arXiv 2208.11434](https://arxiv.org/abs/2208.11434v1)
- Nexar's incident dataset (collision / near-collision / normal, with weather and lighting labels) was used for both the VLM benchmark and NVIDIA's fine-tune. — [Nexar blog](https://empiricearth.com/insights/benchmarking-ai-for-dashcam-video-understanding-insights-from-nexars-large-scale-incident-dataset); [arXiv 2603.18178](https://arxiv.org/abs/2603.18178)
- AccidentBench has about 2,000 accident videos and 19k QA pairs. — [arXiv 2509.26636](https://arxiv.org/abs/2509.26636)
- DriveBench includes corrupted-input settings. VLMs stay confident and answer from priors when the image is degraded. — [arXiv 2501.04003](https://arxiv.org/abs/2501.04003)
- Nexar found rare conditions get the majority label; even day vs night classification sometimes defaulted to the majority. — [Nexar blog](https://empiricearth.com/insights/benchmarking-ai-for-dashcam-video-understanding-insights-from-nexars-large-scale-incident-dataset)
- DashCop (arXiv 2503.00428) is a dashcam traffic-violation pipeline, for two-wheelers, showing classic-CV violation detection from dashcam video. — [arXiv 2503.00428](https://arxiv.org/pdf/2503.00428)

### Inferences
- Main false-positive risks:
  - Night headlights and taillights break bbox-size distance.
  - Rain or wiper occlusion drops tracks, creating fake "new track enters lane" cut-ins.
  - Sun glare washes out traffic-light colour.
  - Curves and hills break flat-road distance geometry.
  - Rear cameras at night see headlights only, so tailgater distance is unreliable.
- Mitigations:
  - Run a cheap image-quality gate first: brightness, blur, VLM weather/lighting tags, which VLMs handle well.
  - Abstain when quality is low ("unknown context — score unchanged") rather than guess.
  - Require track persistence of N frames before declaring a cut-in.

### Gaps
- I did not find per-condition (night / rain) accuracy for lane or vehicle detectors on BDD100K splits, or a public dataset for turn-signal use, stop-sign compliance, or tailgating from consumer dashcams.

## 5. Context correction of a score, and what vendors publicly describe

### Takeaway
The big fleet vendors publicly market video for exoneration and context, and score with time-based headway and event triggers. I found **no** public description of an automated rule that removes or reduces a score penalty because video showed a cut-in. Exoneration appears to be human-reviewed: claims defence and coaching. An automated "forgive the brake if a cut-in is confirmed" rule would be a differentiator, but it is unproven.

### Cited Findings
- Netradyne markets HD video for establishing crash context and supporting insurance claims. It has a case video titled "How Netradyne exonerated a fleet involved in a collision". — [Netradyne video](https://www.netradyne.com/videos/how-netradyne-exonerated-a-fleet-involved-in-a-collision)
- Netradyne's GreenZone score covers 100% of drive time as a positive-reinforcement score. I could not fetch the March 2024 "GreenZone Score Enhancement" press release (403). Its title says "boost driver advocacy", but I could not confirm the mechanism. — [BusinessWire listing](https://www.businesswire.com/news/home/20240328244842/en/Netradyne-Introduces-GreenZone-Score-Enhancement-to-Boost-Driver-Advocacy-and-Safety)
- Netradyne has added AI agents that automate the response to in-cab camera data. — [TruckingInfo](https://www.truckinginfo.com/news/netradyne-intelligence-uses-new-ai-agents-to-automate-response-to-in-cab-camera-data)
- Trade-press coverage describes "video evidence" as the next wave of driver scoring. I did not read it in full. — [CCJ](https://www.ccjdigital.com/business/article/14929847/video-evidence-the-next-wave-of-driver-scoring)
- Samsara has camera-vision tailgating detection with time-based following-distance thresholds. — [CCJ](https://www.ccjdigital.com/samsara-adds-camera-vision-to-catch-distracted-driving-tailgating/); [Samsara KB](https://kb.samsara.com/hc/articles/360043193612)
- My search surfaced no Nauto or Lytx public documentation of automated score adjustment from video context; Lytx scoring is described as review of triggered events. — search results summarised in this session; no primary doc found.

### Inferences
Possible scoring design for this app:
- **Forgive, don't reward.** A confirmed cut-in (new track enters the ego lane with time headway under ~1 s, within ~2 s before the brake) removes that brake's penalty from the braking sub-score. It does not add points, so a false positive can only cost the user a missed penalty.
- **Context can also penalise.** Short headway (under 1 s for over 15 s, matching Samsara's default) is the user's fault and could feed a new following-distance component. A hard brake with no lead vehicle and a green light is unforgiven. A brake at a red light or stop sign that was obeyed is neutral. A rolled stop sign is a negative, if confidence is high.
- **Confidence-gated with an abstain path.** Apply a correction only when CV and VLM agree, or CV confidence is high and the quality gate passes. Otherwise score unchanged, and say so in the recap. This fits the app's "tell the truth" value.
- **Rear tailgater:** context only, never a penalty to the driver, and possibly coaching ("you braked hard with a tailgater behind").

### Gaps
- I found no insurer (UBI) or fleet-vendor document describing automated context-based score correction, and no independent evaluation of vendor exoneration claims (the "up to 80%" figure seen in search snippets is an unverified third-party claim). Nauto's scoring documentation was not retrieved.
