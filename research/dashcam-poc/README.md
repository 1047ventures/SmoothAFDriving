# Dash cam prototype

Throwaway test of judging driving context from dash cam video, run on public-domain
Wikimedia Commons clips. Not part of the app. Background: `reports/Dash cam driving context.md`.

```sh
python3 -m venv venv && ./venv/bin/pip install ultralytics lap
./venv/bin/python lead.py clip.mp4 out/ --fov 50   # annotated.mp4 + result.json
python3 post.py out/result.json                     # drops lane changes undone within 6 s
```

What it does: YOLOv8s finds vehicles and ByteTrack follows them. Painted lines come
from colour masks plus Hough lines, tracked by where they meet the bottom of the
frame. Our lane is between the nearest line each side of the camera. Our own lane
change is every line sliding sideways together by about a lane in 4 s. A new car
ahead is a cut-in unless we changed lanes within a few seconds. Distance is from the
car's pixel width and an assumed lens angle, so it's rough until a real camera's
lens is known.

## Results, Nov 7 2026

**I-270, 5 min, clear day (checked by eye):**
- Our lane changes: all 3 real ones found. Also one probable duplicate, and one false
  flag near the concrete wall.
- Cut-ins: both real ones found (an SUV from the left lane, at 11 m and 5.5 m). A
  car ahead appearing because we moved over was correctly labelled as our lane change.
- Lane found in 97% of frames, car ahead in 92%.
- Ran about 2x faster than real time on an M-series Mac.

**Rain with wipers (70mai clip):**
- Lane found in only 40% of frames.
- Missed our lane change.
- Counted our own hood as a car 1 m ahead.

**Edited montage (Slovenia):** a jump cut showed up as a fake cut-in. Real dash cam
files are continuous, so this won't happen with real footage.

## Lessons
- The phone's own gyro and GPS should confirm our lane changes. Paint alone gets
  fooled by walls and rain.
- Mask our own hood, and drop vehicles touching the bottom edge.
- Distance needs the real camera's lens.
- Rain and night need a learned lane model (YOLOPv2 / UFLD), or should be marked
  "can't judge".
