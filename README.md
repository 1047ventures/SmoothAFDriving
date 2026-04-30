# Smooth AF — Driving tracker

Single-file PWA. Opens on desktop as a demo. Installs on iPhone as a standalone app with real GPS + DeviceMotion recording.

## Files

    index.html          app shell + styling
    app.js              recording engine, smoothness algorithm, review rendering
    sw.js               service worker (offline cache)
    manifest.json       PWA manifest (icons, colors, display mode)
    icon-192.png        app icon (192x192)
    icon-512.png        app icon (512x512)

No build step. No backend. No dependencies beyond Leaflet (pulled from unpkg).

## Try it locally

From this folder:

    python3 -m http.server 8000

Then open http://localhost:8000 in a browser and click **Replay demo drive**. Real recording won't work on desktop (no phone sensors), so the demo replay is the way to test the algorithm + review rendering.

## Install on your iPhone

iOS requires **HTTPS** for DeviceMotion, Geolocation, and the PWA manifest. So pick one of these to host:

- **Netlify Drop** (easiest): drag this folder onto https://app.netlify.com/drop → get a URL in seconds
- **GitHub Pages**: push this folder to a repo, enable Pages from the repo settings
- **Vercel / Cloudflare Pages**: same idea, drag-and-drop or git-connect

Once hosted, on your iPhone:

1. Open the URL in Safari
2. Tap the Share button → **Add to Home Screen**
3. Launch from the home-screen icon (not Safari) so it runs standalone
4. Tap **Start drive** → grant Motion + Location permissions

Sharing: anyone you send the URL to can do the same four steps — that covers the "eventually share with others" goal until you want to go native.

## Algorithm notes

Scoring uses **GPS-derived** longitudinal and lateral acceleration, not raw DeviceMotion. That's deliberate:

- **Longitudinal** (brake/accel): derivative of GPS speed, EMA-smoothed
- **Lateral** (turning): `v × dHeading/dt`, EMA-smoothed
- **Event thresholds**: hard brake < -3.5 m/s², hard accel > 2.8 m/s², sharp turn > 3.6 m/s²

Raw DeviceMotion is still captured — it drives the live G-force readout — but using it for scoring would require vehicle-frame calibration (phone orientation changes mid-drive). GPS gives frame-invariant signals for free.

Score penalty: brake -6, turn -5, accel -4, each scaled by severity above threshold. Floor 0, ceiling 100.

The map polyline is colored per-segment by local harshness magnitude: green (smooth) → olive → amber → orange → red (harsh). Event markers drop B / A / T pins with a popup showing speed and severity.

## Next steps

Things to take on when you're ready:

- Vehicle-frame calibration so DeviceMotion supplements GPS (needed for sub-second event resolution)
- Turn-by-turn event detail page (tap a marker → full telemetry snippet)
- Share-a-drive link (snapshot of one drive you can post or text)
- Cohort comparison (your score vs. the student cohort)
- Native wrapper via Capacitor when you want App Store distribution
