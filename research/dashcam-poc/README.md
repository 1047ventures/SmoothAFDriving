# Dash cam prototype

Throwaway test of judging driving context from dash cam video, run on public-domain
Wikimedia Commons clips. Not part of the app. Background: `reports/Dash cam driving context.md`.

```sh
python3 -m venv venv && ./venv/bin/pip install onnxruntime opencv-python numpy
curl -LO https://github.com/hustvl/YOLOP/raw/main/weights/yolop-640-640.onnx
./venv/bin/python lead.py clip.mp4 out/ --fov 50   # annotated.mp4 + result.json
python3 post.py out/result.json                     # merges / drops lane-change flags
```

## Trained model: YOLOP

[YOLOP](https://github.com/hustvl/YOLOP) is MIT-licensed. It was trained on BDD100K,
100k real dash cam videos that include rain and night. One pass finds vehicles, the
drivable road and lane lines, at about 40–70 ms a frame on a laptop CPU.

It runs from its ONNX file through onnxruntime. Our own code does the pre- and
post-processing (`yolop_model.py`), so no third-party Python runs. The repo's
PyTorch weights would mean loading pickled code, and we avoid that.

Ultralytics YOLOv8 was used in the first version and dropped. It is AGPL-3.0, which
is risky for a paid app's backend.

## How it judges

- **Our lane:** between the nearest lane line on each side of the camera.
- **Our lane change:** all the lines slide sideways together by about a lane within
  4 s. It has to hold, not snap back.
- **Cut-in:** a new car becomes "ahead" while we did NOT change lanes.
- **Can't judge:** fewer than 70% of the frames around the moment show clear lane
  lines (rain, night, glare, worn paint). The score is left alone.
- **Hood:** a box reaching the bottom edge and wider than half the frame is our own
  car.
- **Distance:** from the car's pixel width and the lens angle. This stays rough until
  we know the real camera's lens.

## Results, Nov 7 2026

**I-270, 5 min, clear day**
- Clear view: 95% of the time.
- Our lane changes: exactly the 3 real manoeuvres, no false ones.
- Cut-ins: none flagged, which is correct.
- New car ahead after our own lane change: all 3 labelled "we changed lanes".
- Correction: the hand-made v2 flagged 2 "cut-ins" at 88 s and 98 s, and I first
  agreed they were real. With proper lanes, it's an SUV staying in the next lane.

**Rain with wipers (70mai)**
- Clear view: 8% of the time.
- Its one flag is marked "can't judge", which is what should happen.
- It still misses the lane change there.

## Next, when there's real footage
- Know the lens (Viofo A229 Pro specs), or add a trained depth model (Depth Anything
  V2 Small, Apache-2.0), for real distances.
- Have the phone's gyro and GPS confirm our lane changes.
- Use a trained lane model for rain and night (YOLOPv2 / UFLDv2, both MIT) if YOLOP
  isn't enough there. Load it from ONNX.
