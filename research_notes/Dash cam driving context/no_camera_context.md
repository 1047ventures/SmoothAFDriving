# Understanding driving context without a camera (for an indie iOS driving-score app)

Context: the app (Smooth AF Driving) already has GPS at 1 Hz, phone accelerometer and gyro at 60 Hz, an Ancel BLE ELM327-style OBD-II dongle, and a Supabase backend with many users' drives. Notes compiled 2026-11-06. Several pricing figures change often and are marked as uncertain.

## 1. OBD beyond standard PIDs: Mode 21/22, ATMA sniffing, opendbc / OBDb, and clone limits

### Takeaway
An ELM327 BLE dongle can read some manufacturer-specific data. That means polling Mode 21/22 (UDS ReadDataByIdentifier) DIDs from community databases such as OBDb, plus limited passive sniffing with ATMA on cars whose OBD port carries broadcast traffic. It is fragile, car-specific work. Clone adapters drop frames under load ("BUFFER FULL"), and newer cars (for example Stellantis 2018+ with its Security Gateway) firewall the OBD port. So steering angle, brake pressure, turn signals or radar lead distance are only realistic as a per-make, opt-in enhancement, not a baseline feature.

### Cited Findings
- **opendbc** (comma.ai) is "a Python API for your car." It has DBC files (`opendbc/dbc/`), CAN parse/build (`opendbc/can/`), a high-level car interface (`opendbc/car/`), and safety code. Each port's `carstate.py` decodes values such as speed and steering angle from CAN using the car's DBC. Most car support comes from the community — [opendbc GitHub](https://github.com/commaai/opendbc)
- opendbc's supported-car list shows **405 known cars across 31 makes**: Acura, Audi, BYD, Chevrolet, Chrysler, CUPRA, Dodge, Ford, Genesis, GMC, Honda, Hyundai, Jeep, Kia, Lexus, Lincoln, MAN, Mazda, MG, Nissan, Peugeot, Porsche, Ram, Rivian, SEAT, Subaru, Škoda, Tesla, Toyota, Volkswagen (plus comma's own) — [opendbc docs/CARS.md](https://github.com/commaai/opendbc/blob/master/docs/CARS.md)
- comma's hardware connects through a **car harness to two CAN buses** (behind the camera/ADAS module), not through the OBD port. That is why opendbc decodes are written against the internal buses — [opendbc GitHub](https://github.com/commaai/opendbc)
- **OBDb** is a community database of diagnostic parameters, scalings and DTCs, organised per make/model. It has about 738 repos, each with a `signalsets/v3` folder, licensed CC-BY-SA-4.0, and is browsable at obdb.community — [OBDb GitHub org](https://github.com/OBDb) (via search summary; the obdb.community explorer page did not render for fetching)
- Mode 22 is not part of SAE J1979. It is defined by SAE J2190 (Ford/GM). Toyota uses Mode 21 for manufacturer-specific data — [OBD-II PIDs reference](https://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq.ipfs.4everland.io/wiki/OBD-II_PIDs.html)
- You can enumerate supported extended PIDs with bitmask queries. In Mode 22 the bitmask PIDs step by 256 (0x100, 0x200, ...) instead of 32 — [PriusChat custom Torque PIDs thread](https://priuschat.com/posts/3582276)
- Car Scanner ELM OBD2 (iOS) supports custom extended PIDs over a BLE ELM327 adapter. This shows the approach works on iOS with BLE dongles — [App Store: Car Scanner](https://apps.apple.com/th/app/car-scanner-elm-obd2/id1259933623?l=th)
- **Steering angle is hit-or-miss.** A Fiat owner found no OBD-visible broadcast carrying steering angle and got "mixed results" with UDS service 22 via ELM327 — [Fiat Forum](https://www.fiatforum.com/threads/obd-ii-epid-for-steering-wheel-angle.451078). An anecdotal Reddit report says Toyota commonly broadcasts steering angle on CAN ID 0x025 (12 bits) and Car Scanner can show it, but it varies by model and year — [r/CarHacking](https://lr.in.psf.lt/r/CarHacking/comments/1fkf0ux/has_anyone_successfully_captured_steering_wheel) (anecdotal, unverified)
- **ELM327 clone limits** (Linux `can327` driver docs):
  - Under heavy traffic the UART output buffer overflows, monitoring aborts with "BUFFER FULL", and truncated lines can be misparsed.
  - Clones may report any version string, regardless of their real feature set.
  - Some clones cannot send RTR frames, and they lack `AT PB`, so bitrate and 11/29-bit mode can't change on the fly.
  - `AT MA` (Monitor All) is always silent.
  - Bitrates are limited to 500000/n, there is no full duplex, and versions before 1.3 are unusable — [kernel.org can327 docs](https://docs.kernel.org/networking/device_drivers/can/can327.html)
- **Gateways.** Stellantis/FCA's Security Gateway (introduced around the 2018 Jeep Wrangler JL) sits between the OBD port and the internal CAN buses. CAN C and CAN IHS are the "private" side. Unauthenticated access is "view only": reading codes and live data works, writes and actuator tests don't — [Stellantis TSB via NHTSA](https://static.nhtsa.gov/odi/tsbs/2022/MC-10221422-9999.pdf); [ads-pro.it SGW guide](https://ads-pro.it/en/security-gateway-sgw-and-secoc-modules-stellantis-fca-technical-guide-2018-2026/) (vendor source, mixed quality)
- A gateway patent describes passing only whitelisted CAN IDs from the OBD bus to internal buses. It shows the general design, not confirmed for any specific OEM — [US10404709B2](https://patents.google.com/patent/US10404709)

### Inferences
- **Two very different techniques:**
  - **Polling Mode 21/22 DIDs** is request/response, works through most gateways for read-only data, and is fine at a few Hz over BLE. Candidate signals: accelerator pedal %, brake switch or master-cylinder pressure, steering angle, gear, wheel speeds, and sometimes turn-signal state from the body module.
  - **Passive sniffing (ATMA)** only works if the OBD port carries broadcast traffic. Gatewayed cars won't show it, and BLE clones will overflow on a busy 500 kbps powertrain bus. Use ATCRA/ATCF filters to monitor a single ID such as a steering-angle ID, rather than ATMA everything.
- Radar lead-car distance, ACC state and ABS/ESC activation sit on ADAS or chassis buses. They are documented in opendbc DBCs for many makes, but those buses are generally reached via the camera harness, not the OBD port. Treat lead distance as not feasible via a $20 BLE OBD dongle on most cars.
- Toyota/Lexus, Honda, Hyundai/Kia, VW group, Ford and GM have the deepest community decode coverage, based on opendbc make counts. This matches the brands most represented in Car Scanner/Torque PID communities (inference).
- For the app, the realistic path is to ship standard PID throttle/RPM (already there), then add an opt-in "extended PIDs" table keyed by VIN/make from OBDb signalsets. Start with brake switch/pressure and pedal %, and validate per car with the owner's own vehicle first.
- OBDb is CC-BY-SA-4.0, so bundling its data needs attribution, and derived datasets carry share-alike obligations (inference from the licence).

### Gaps
- CSS Electronics DBC collections were not researched (no fetch made). They are mostly commercial or J1939 heavy-duty, and their passenger-car OEM coverage is unverified.
- No authoritative list of which OEMs/years gateway the OBD port (Toyota, VW, GM VIP, etc.). Only Stellantis was confirmed.
- No source confirmed specific Mode 21/22 DIDs for brake pressure or turn signals on any make. Check OBDb signalsets per model.
- The Ancel dongle's chip (genuine ELM327 vs clone, or STN-family) and its BLE throughput are unknown. Test with `ATI`/`STI` and timed polling.

## 2. Map context: map-matching plus speed limits, stop signs, signals, curves, road type

### Takeaway
Map-match the 1 Hz trace, then attach road attributes. Mapbox Map Matching (100k free requests/month, then $2.00/1k) and TomTom Snap to Roads (returns speed limits; small free allowance) are the cheapest paid routes. Google's speed limits need an enterprise Asset Tracking licence, which rules it out for an indie. OSM/Overpass is free, but OSM speed-limit coverage is thin (about 5–12% of roads globally). Stop-sign and signal completeness is unmeasured, so "did they stop at the stop sign" works best where OSM has `highway=stop` / `highway=traffic_signals` nodes, backed by crowd-derived stop locations.

### Cited Findings
- **Mapbox Map Matching API.** 100,000 requests/month free, then $2.00 per 1k (100k–500k), $1.60 per 1k (500k–1M), $1.20 per 1k (1M+). Directions has the same tiers. The Mapbox pricing page notes a **Commercial Application License is required for vehicle usage** — [Mapbox pricing](https://www.mapbox.com/pricing)
- **TomTom.**
  - Snap to Roads "snap[s] GPS traces to a road network and retrieve[s] speed limits, lanes, and more."
  - Official page: 2.5K free requests/month for Snap to Roads, 20K for Traffic Flow Segment Data, 200K for traffic tiles — [TomTom pricing](https://docs.tomtom.com/pricing)
  - Third-party sites instead describe 2,500 non-tile requests per day and Snap to Roads at $2.50/1k. Pricing reportedly changed on 1 July 2026 — [frontdeskreview TomTom](https://frontdeskreview.com/software/maps-api/tomtom/); [apio TomTom Routing](https://apio.sh/apis/tomtom-routing) (conflicting; verify)
  - Reported per-request cap of 5,000 points / 100 km — [TomTom Snap to Roads docs](https://docs.tomtom.com/snap-to-roads-api/documentation/snap-to-roads-api/synchronous-snap-to-roads) (via third-party summary)
- **Google Roads API.**
  - Speed Limits requires the Asset Tracking plan, which targets fleets with ≥20,000 active assets — [Google Asset Tracking plan](https://developers.google.com/maps/solutions/asset-tracking/asset-tracking-plan)
  - A blog estimates the licence at about $10k/year, with Speed Limits around $20 CPM (unverified) — [afi.io blog](https://blog.afi.io/blog/how-to-get-the-speed-limit-in-google-maps/)
  - Snap to Roads is limited to 100 points per request — [Roads API usage & billing](https://developers.google.com/maps/documentation/roads/usage-and-billing)
- **OSM speed-limit coverage:**
  - About 5% of roads worldwide carried `maxspeed` in 2014 (the US was guessed lower) — [OSM Help](https://help.openstreetmap.org/questions/37328/about-purchase-api-for-maxspeed-and-its-usage-limit)
  - About 12% per a later NLnet project page — [NLnet OSM Speed Limits](https://nlnet.nl/project/OSM-SpeedLimits/)
  - 7.4% of road elements in a 2019 extract — [ResearchGate figure](https://www.researchgate.net/figure/Proportion-of-the-total-length-of-all-roads-with-maximum-speed-information-in_fig1_338659062)
  - The OSM wiki documents per-state default limits and mph formatting for the US — [OSM wiki Maxspeed](https://wiki.openstreetmap.org/wiki/OSM_tags_for_routing/Maxspeed)
- Imputing missing speed classes from OSM features plus imagery is an active research area. That is evidence the raw tags are incomplete — [ScienceDirect 2025](https://www.sciencedirect.com/science/article/pii/S0198971525001450)

### Inferences
- **Cheapest robust pipeline:**
  1. Run self-hosted map matching on OSM with OSRM's `match` service or Valhalla's `trace_attributes`, on a small VPS or at batch time on the backend after the drive. There are no per-request fees, and Valhalla returns edge attributes (road class, speed, curvature-ish data, intersections).
  2. Pull stop/signal/crossing nodes from a periodic OSM extract rather than live Overpass calls. The public Overpass instances are rate-limited and not meant for app production traffic (prior knowledge, not re-verified this session).
- **Curvature doesn't need a map.** Compute it from the matched geometry, or directly from GPS heading change plus gyro yaw rate. That gives "speed vs curve radius" (lateral g expected) without any paid API.
- **Stop-sign judgment:** detect a speed minimum below 1–2 mph within about 30 m before a `highway=stop` node on the matched approach direction. Where OSM lacks stop tags, crowd data can find them (point 4: locations where nearly all drivers' speeds dip to about 0).
- **Mapbox's vehicle-use licence clause** may apply to a driving app. Read the Product Terms before using Mapbox Map Matching in production. This is a real cost/licence risk, not just per-request pricing.
- Speed-limit data is best used softly ("above typical speed for this road") given the coverage gaps. A wrong limit that unfairly penalises users conflicts with the app's "tell the truth" value.

### Gaps
- HERE's 2026 pricing and free tier were not found (one comparison site quotes $2.92/1k for routing, unverified — [placematic](https://placematic.com/compare/here-vs-tomtom/)).
- Whether Mapbox Map Matching annotations (`maxspeed`, `congestion`) cost extra was not confirmed. The pricing page is silent.
- US-specific completeness of OSM `highway=stop`, `traffic_signals`, `crossing` was not found. Measure it with the ohsome dashboard or by querying an extract over the app's own drive areas.
- TomTom's post-July-2026 rates are unconfirmed.

## 3. Live/historical traffic and weather to normalise scores

### Takeaway
Weather is cheap and easy. Apple WeatherKit includes 500,000 calls/month free with the developer membership, including historical data. Open-Meteo's free tier is non-commercial only, and its historical API needs the Professional plan. Traffic is costlier. TomTom Traffic Flow Segment Data has a free allowance (20k/month on the official page). Mapbox `congestion` comes via Directions/Map Matching annotations. The app can also infer congestion itself from GPS speed vs typical speed, which is free and already partly done ("traffic stretch").

### Cited Findings
- **WeatherKit.** Up to 500,000 calls/month included per Apple Developer Program membership. Paid tiers from $49.99 for 1M up to $9,999.99 for 200M per month. Unused calls don't roll over — [Apple WeatherKit](https://developer.apple.com/weatherkit). Historical data is included in the free tier — [Monstarlab engineering](https://engineering.monstar-lab.com/en/post/2023/05/01/iOS-WeatherKit/) (secondary)
- **Open-Meteo.** The free API is for non-commercial use only (600/min, 5k/hr, 10k/day, 300k/month). Commercial plans: Standard 1M/month, Professional 5M/month, Enterprise 50M+. Historical weather requires Professional or above. Prices are not listed on the page — [Open-Meteo pricing](https://open-meteo.com/en/pricing)
- **TomTom Traffic Flow Segment Data.** 20K free requests/month per the official pricing page — [TomTom pricing](https://docs.tomtom.com/pricing)

### Inferences
- Use WeatherKit (native Swift on iOS, or its REST API from a Supabase function). One call per drive at the start point covers precipitation, visibility and road temperature context. That is under 1 call per drive, far inside 500k/month. Use it to soften the braking penalty in rain/snow, or to label "rain drive" in the recap.
- Commercial apps should avoid Open-Meteo's free tier. Its licence forbids commercial use, and a subscription-based app counts as commercial.
- **Traffic normalisation without an API.** On repeated segments, compare this drive's speed to the median of all drives at that hour/day-of-week (point 4). Low speed with frequent stops relative to free-flow means congestion, so don't penalise momentum. This is more relevant to "smoothness" than external congestion levels.
- Live traffic APIs mainly add value at drive time (real-time coaching). Historical normalisation can be done after the drive from crowd data.

### Gaps
- HERE and Mapbox historical/typical-traffic pricing was not retrieved.
- Open-Meteo's commercial dollar prices are not published on the page.

## 4. Crowd comparison on road segments (Strava/Waze style)

### Takeaway
Comparing a driver to others on the same map-matched segment and time bucket is the fairest normaliser: "you braked harder than 80% of drivers at this light." Telematics vendors use similar crowd context. The main costs are data density (many traversals per segment) and privacy. Location traces are highly re-identifying: 4 spatio-temporal points identify 95% of people. Store aggregates per segment, not raw traces, for comparison.

### Cited Findings
- **Re-identification risk.** In hourly, antenna-resolution mobility data for 1.5M people, **four spatio-temporal points uniquely identify 95%** of individuals. Uniqueness decays only as about the 1/10 power of resolution, so coarsening gives little anonymity — [de Montjoye et al. 2013, Sci. Reports (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3607247)
- A 2025 study on GPS trip data found 4 random points re-identify a significant share of trips in Berlin and Beijing datasets. A widely used obfuscation technique showed limited reliability — [arXiv 2502.08217](https://arxiv.org/pdf/2502.08217)
- Zendrive compared 33,450 risky events with NYPD crash reports and reported 71% location overlap. This suggests crowd-aggregated hotspots carry signal (promotional, dated) — [diginomica](https://diginomica.com/zendrive-says-big-data-eliminate-traffic-fatalities-really)
- A distraction-scoring patent shows episodes overlaid on a map with context such as vehicle speed and road type — [US11932257B2](https://patents.google.com/patent/US11932257B2)

### Inferences
- **Data needed (rule of thumb, not sourced).** A per-segment distribution starts to be meaningful at about 20–30 traversals from 5 or more distinct drivers per segment × direction × time bucket. Below that, fall back to road-class priors (all "residential stop-controlled approaches"). For a small user base, segments will be dense only on owners' commutes. Pool by road class and maneuver type (stop approach, signal approach, curve of radius R) first, then per-segment when dense.
- **Implementation on Supabase:**
  - After the drive, map-match it and emit per-segment rows (segment_id, direction, hour bucket, entry/exit speed, peak decel, stop yes/no).
  - Keep the aggregate table (counts, percentiles via t-digest or histograms) and expire raw per-user segment rows.
  - PostGIS plus a nightly aggregate job is enough.
- **Privacy:**
  - Never expose other users' traces. Enforce k-anonymity on aggregates (only show comparisons where ≥k distinct users).
  - Trim the first and last few hundred metres of each drive before contributing, to avoid home/work endpoints (similar in spirit to Strava privacy zones; the Strava attack literature was not found this session).
  - Disclose segment aggregation in the privacy policy and App Store privacy label.
- Crowd stops also infer stop signs and signals missing from OSM: clusters where most traversals reach 0 mph at the same point.

### Gaps
- No public numbers from Waze/Strava/insurers on minimum traversals per segment.
- No sources found on attacks against Strava privacy zones.

## 5. Phone-only tricks: microphone, CarPlay, Core Motion, barometer, BLE/UWB, phone-use detection

### Takeaway
The useful, low-risk ones are:
- Core Motion `automotive` activity (cheap trip detection and confirmation)
- the barometer (relative altitude for hills/grade, fused with GPS)
- screen-on/phone-motion detection for distraction, which is what CMT uses

CarPlay gives third-party apps no vehicle data. Microphone turn-signal detection is technically plausible, but a privacy and App Review liability. iOS shows a mic indicator and background audio capture for analysis is a hard sell. Defer it.

### Cited Findings
- `CMMotionActivity.automotive` can be true alongside other flags. For example, stopped at a stop sign: stationary=YES, automotive=YES. `CMMotionActivityManager` can also query stored activity history — [CMMotionActivity.h (iOS SDK header mirror)](https://github.com/mstg/iOS-full-sdk/blob/master/iPhoneOS9.3.sdk/System/Library/Frameworks/CoreMotion.framework/Headers/CMMotionActivity.h); [Microsoft .NET iOS binding docs](https://learn.microsoft.com/en-us/dotnet/api/coremotion.cmmotionactivity.automotive?view=net-ios-26.5-10.0&viewFallbackFrom=xamarin-ios-sdk-12)
- **CarPlay app categories:** Audio, Video (parked), Messaging/VoIP, Navigation, EV charging/fueling/parking/public safety/quick food ordering, voice-based conversational apps, and **Driving task** apps, plus widgets and Live Activities (iOS 26). Apple's CarPlay page describes **no API for vehicle data** (speed, gear, sensors). Navigation apps can share route information *to* supported cars — [Apple CarPlay developer page](https://developer.apple.com/carplay/)
- Live Activities appear in CarPlay as of iOS 26 — [addcarwidgets blog](https://addcarwidgets.com/blog/apple-carplay-live-activities-ios-26) (secondary)
- **Road grade from phone sensors.** Gupta et al. (IPSN 2020) fused phone gyro and accelerometer with speed from OBD-II or GPS. They got 90% of grade errors under 0.3° on a 9 km route, about 5× better than baselines. The gyro captures road shape but drifts, so it was the primary sensor — [arXiv 2006.03633](https://arxiv.org/pdf/2006.03633)
- A UCLA study used barometric pressure plus elevation maps to infer vehicle paths (>80% accuracy in some cases). It notes that weather, air movement and drift affect barometer readings — [escholarship UCLA](https://escholarship.org/content/qt9bc89798/qt9bc89798.pdf?t=sengbw)
- **Phone distraction.** CMT defines "phone motion distraction" as the phone moving with its screen on while the vehicle is moving. It used this metric in a 3.8M-trip study of Colorado's hands-free law — [CMT Colorado study](https://www.cmtelematics.com/news/colorados-hands-free-law-reduces-distracted-driving/)
- Research on telling the driver's phone from a passenger's by the gripping hand exists — [arXiv 2111.05738](https://arxiv.org/pdf/2111.05738)

### Inferences
- **Hills:** `CMAltimeter` relative altitude (barometer) over about 10–30 s windows, divided by GPS distance, gives grade. Pressure drift from weather is slow relative to a hill climb, so short-window differencing works. This lets the score stop penalising "coasting slowdown" uphill or "speeding up" downhill, and lets longitudinal accel be gravity-corrected. That matters because the app derives longAccel from GPS speed change.
- **Phone use:** a practical iOS proxy is "app in foreground / screen unlocked while speed > X". `UIApplication` state and protected-data notifications are only partially visible to a backgrounded app, plus large gyro rotations of the phone relative to the car frame (the app already solves axes, so phone-in-hand shows as calibration breaking). That is about all an iOS app can observe of phone use. iOS does not expose other apps' usage.
- **Microphone turn-signal detection:**
  - Feasible in principle (periodic ~1–2 Hz click with a distinct spectral signature).
  - It needs continuous mic capture during drives, which triggers the orange mic indicator and needs an `NSMicrophoneUsageDescription` and background audio justification.
  - It conflicts with the music/podcast audio session, and many EVs/modern cars play the tick quietly or through the speakers alongside music.
  - It undermines trust. Recommend not doing it, or only on-device and opt-in, with no audio stored.
  - The OBD route (body-module DID) is cleaner where available.
- **BLE/UWB:** the app already uses car Bluetooth for "Car Wake". UWB (Nearby Interaction) needs a UWB accessory, and car keys via Wallet are not exposed to third parties. Not useful for context beyond "which car am I in".
- CarPlay: a "Driving task" app category exists, but it is for in-car UI, not data. No context gain.

### Gaps
- Apple's exact rules for Driving Task app entitlements and whether CarPlay connection state is observable by non-CarPlay apps were not confirmed (the CarPlay Developer Guide PDF was not read).
- No study found on barometer-only grade accuracy in vehicles.
- No source found on acoustic turn-signal detection accuracy.

## 6. What telematics insurers and vendors use for context (Progressive, Root, Allstate, CMT, Zendrive)

### Takeaway
Publicly, the big programs score:
- hard braking and rapid acceleration
- time of day (late night)
- mileage
- phone handling/distraction
- speed (sometimes against the posted limit)

Context mostly comes from road type and maps, plus crowd crash hotspots. CMT fuses phone, BLE Tag, connected-car and video data. None publicly claim to use OEM CAN signals from consumer dongles, and formulas are not disclosed.

### Cited Findings
- **Progressive Snapshot** measures time of day, sudden speed changes (hard brakes and rapid accelerations), amount of driving, and, in the app and in some states, phone use. The plug-in device doesn't track phone use but beeps on hard brakes — [Progressive Snapshot FAQ](https://www.progressive.com/auto/discounts/snapshot/snapshot-faq/)
- About 20% of Snapshot users see rate increases — [The Zebra](https://www.thezebra.com/auto-insurance/policies/car-insurance-telematics/snapshot-vs-root-auto-insurance/) (secondary). One review claims midnight–4 a.m. driving is weighted negatively — [autoinsurance.org](https://www.autoinsurance.org/progressive-snapshot-review/) (secondary, not from Progressive)
- **Root** is app-only, with a several-week "test drive" baseline used to accept or reject applicants. Specific factors were not found — [The Zebra](https://www.thezebra.com/auto-insurance/policies/car-insurance-telematics/snapshot-vs-root-auto-insurance/)
- **CMT DriveWell (Fusion)** ingests smartphones, proprietary BLE Tags (windshield-mounted, record motion without the phone), connected vehicles, dashcams and third-party devices — [CMT How it works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/); [MIT CSAIL CMT talk (Madden)](https://cap.csail.mit.edu/sites/default/files/session-pdfs/Madden_Machine%20Learning%20&%20AI%20%20at%20Cambridge%20Mobile%20Telematics.pdf)
- **CMT DriveWell Crash** uses ML on phone/IoT sensors and reports location, time, driver ID, crash intensity, g-force and speed — [CMT Crash](https://www.cmtelematics.com/crash-detector/)
- CMT patents and reports frame distraction detection as coming from phone sensors. Its metric is phone motion with the screen on while the car is moving — [CMT distraction report PDF](https://www.cmtelematics.com/wp-content/uploads/2020/11/CMT_Distraction_Report_11-12_FINAL.pdf); [CMT 2023 report via NCSL](https://documents.ncsl.org/wwwncsl/Transportation/CMT-2023-Distracted-Driving-Report.pdf)
- **Zendrive** markets phone-based detection of phone use and speed. Its assigned patent US10137889B2 covers smartphone accident detection — [diginomica](https://diginomica.com/zendrive-says-big-data-eliminate-traffic-fatalities-really); [US10137889B2](https://patents.google.com/patent/US10137889B2/en)
- Other patents: map overlay of phone-use segments (US 12,415,522, assignee unconfirmed) — [Justia](https://patents.justia.com/patent/12415522). Distraction episodes with speed/road-type context (US11932257B2, assignee unconfirmed) — [Google Patents](https://patents.google.com/patent/US11932257B2). Comparing vehicle speed to the posted limit for a monitored road section (US8384555B2, not tied to Zendrive) — [Google Patents](https://patents.google.com/patent/US8384555B2/en). "Systems and methods for scoring driving trips" — [USPTO 11072339](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11072339)

### Inferences
- The insurers' public context set (time of day, road type, speed limit, phone use) is mostly about *risk exposure*, not *fairness*. This app's goal of a fair smoothness score is better served by crowd-segment normalisation, grade, and weather than by insurer-style exposure factors.
- Distraction is where phone-only data is strongest and most proven (CMT's metric). It is a natural next signal for a "better drivers" mission, though it should feed coaching, consistent with the app's "events never scored" stance.

### Gaps
- Allstate (Drivewise/Milewise) public docs were not retrieved.
- No insurer publicly discloses weighting or the exact map/weather context used.
- Assignees of US11932257B2 and US12415522 were not verified (both may be CMT or Zendrive).

---

## Feasibility ranking for an indie iOS app (synthesis; inference)

| Signal | Cost | Effort | Fairness gain | Verdict |
|---|---|---|---|---|
| Barometer grade (CMAltimeter + GPS) | Free | Low | High (hills distort GPS longAccel) | Do first |
| WeatherKit per drive | Free (500k/mo) | Low | Medium | Do first |
| Self-hosted OSM map-matching (Valhalla/OSRM) + road class/curvature | VPS cost | Medium | High | Do |
| Stop-sign/signal approach judging (OSM nodes + crowd-inferred stops) | Free | Medium | High where tagged | Do after map-matching |
| Crowd segment percentiles (Supabase/PostGIS aggregates, k-anon) | Free | Medium–High | Highest, needs data density | Start by road class, refine per segment |
| Phone-use/distraction (screen-on + phone motion) | Free | Low–Medium | High for safety coaching | Do (coaching, not score) |
| Mapbox Map Matching | 100k/mo free then $2/1k; vehicle licence clause | Low | Same as self-hosted | Check licence first |
| TomTom Snap to Roads speed limits | Small free tier; pricing changed Jul 2026 | Low | Medium | Optional |
| Google Roads speed limits | Enterprise licence | — | — | Not feasible |
| OBD Mode 21/22 extended DIDs (pedal %, brake, steering) | Free (OBDb CC-BY-SA) | High, per car | High where available | Opt-in, per make, start with owner's car |
| ATMA CAN sniffing on BLE clone | Free | High, flaky | Medium | Filtered single-ID only; skip broad ATMA |
| Radar lead distance / ACC / ESC via OBD | — | — | — | Mostly not reachable via OBD port |
| Mic turn-signal detection | Free | Medium | Low–Medium | Defer (privacy/trust) |
| CarPlay vehicle data | — | — | — | No API exists |
