"""Dash cam prototype v2: our lane from painted lines, our own lane changes, the car ahead, cut-ins.

usage: python lead2.py clip.mp4 out_dir [--fov 50] [--fps 10] [--horizon 0.5] [--hood 0.92] [--cam-x 0.5]

Lanes: classic computer vision, no model. White and yellow paint near the road, edges,
then straight-line fits on each side of where our car is (--cam-x, the camera's spot
across the frame). Cheap enough to run on a phone or a small in-car computer.

Our lane change: the painted line we're crossing sweeps past --cam-x, and the lane we
end up in is on the other side of it. A car that becomes "ahead" because WE moved is
not a cut-in.
"""
import argparse, json, math, os
import cv2
import numpy as np
from ultralytics import YOLO

VEHICLES = {2: ('car', 1.8), 3: ('motorbike', 0.8), 5: ('bus', 2.5), 7: ('truck', 2.5)}

ap = argparse.ArgumentParser()
ap.add_argument('clip'); ap.add_argument('out')
ap.add_argument('--fov', type=float, default=50)
ap.add_argument('--fps', type=float, default=10)
ap.add_argument('--model', default='yolov8s.pt')
ap.add_argument('--horizon', type=float, default=0.5)
ap.add_argument('--hood', type=float, default=0.92)
ap.add_argument('--cam-x', type=float, default=0.5)
ap.add_argument('--stable', type=float, default=1.0)
ap.add_argument('--start', type=float, default=0)
ap.add_argument('--secs', type=float, default=0)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

cap = cv2.VideoCapture(a.clip)
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
W, H = int(cap.get(3)), int(cap.get(4))
step = max(1, round(src_fps / a.fps))
focal = (W / 2) / math.tan(math.radians(a.fov / 2))
hy, by, x0 = H * a.horizon, H * a.hood, W * a.cam_x
ROI_TOP = hy + (by - hy) * 0.25     # far paint is too thin to trust
model = YOLO(a.model)
writer = cv2.VideoWriter(os.path.join(a.out, 'annotated.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), src_fps / step, (W, H))
if a.start: cap.set(cv2.CAP_PROP_POS_MSEC, a.start * 1000)


# ── Lanes ──────────────────────────────────────────────────────────────────
def paint_segments(frame, vehicle_boxes):
    """Line segments on painted lane markings in the road area, cars masked out."""
    roi = frame[int(ROI_TOP):int(by)]
    hls = cv2.cvtColor(roi, cv2.COLOR_BGR2HLS)
    l, s = hls[:, :, 1], hls[:, :, 2]
    # White: bright compared with the road around it. Yellow: hue band with some colour.
    road = cv2.medianBlur(l, 31)
    white = ((l.astype(int) - road) > 35) & (l > 140)
    hch = hls[:, :, 0]
    yellow = (hch > 12) & (hch < 35) & (s > 70) & (l > 90)
    mask = ((white | yellow) * 255).astype(np.uint8)
    for (x1, y1, x2, y2) in vehicle_boxes:
        cv2.rectangle(mask, (int(x1), int(y1 - ROI_TOP)), (int(x2), int(y2 - ROI_TOP)), 0, -1)
    edges = cv2.Canny(mask, 50, 150)
    segs = cv2.HoughLinesP(edges, 1, np.pi / 180, 25, minLineLength=int(H * 0.04), maxLineGap=int(H * 0.06))
    out = []
    if segs is None:
        return out, mask
    for x1, y1, x2, y2 in segs.reshape(-1, 4).tolist():
        y1 += ROI_TOP; y2 += ROI_TOP
        if y1 == y2: continue
        slope = (x2 - x1) / (y2 - y1)          # dx per dy: steep lines near 0
        if abs(slope) > 2.5: continue           # near-horizontal: stop lines, shadows
        out.append((x1, y1, x2, y2, slope))
    return out, mask


def x_at(line, y):
    """line = (slope, x at bottom row)."""
    slope, xb = line
    return xb + slope * (y - by)


class Lane:
    """Painted lines tracked over time by where they meet the bottom of the frame.

    Our lane is between the nearest tracked line left of the camera and the nearest
    right of it. Our own lane change is a tracked line sliding smoothly across the
    camera's position: moving left to right means WE moved left.
    """
    def __init__(self):
        self.lines = {}        # id -> dict(xb, slope, seen, born, side_hist)
        self.next_id = 0
        self.width = W * 0.55
        self.changes = []
        self.last_change = -99
        self.slide = []
        self.pending = None

    def update(self, t, segs):
        obs = []
        for x1, y1, x2, y2, slope in segs:
            xb = x1 + slope * (by - y1)
            if -0.2 * W < xb < 1.2 * W:
                obs.append((xb, slope, math.hypot(x2 - x1, y2 - y1)))
        # cluster this frame's segments into lines
        obs.sort()
        clusters = []
        for o in obs:
            if clusters and o[0] - clusters[-1][-1][0] < W * 0.03: clusters[-1].append(o)
            else: clusters.append([o])
        found = []
        for c in clusters:
            wsum = sum(o[2] for o in c)
            if wsum < H * 0.06: continue
            found.append((sum(o[0] * o[2] for o in c) / wsum, sum(o[1] * o[2] for o in c) / wsum))
        # match to tracked lines
        used = set()
        shifts = []
        for xb, slope in found:
            best = min(self.lines.items(), key=lambda kv: abs(kv[1]['xb'] - xb), default=None)
            if best and abs(best[1]['xb'] - xb) < W * 0.06 and best[0] not in used:
                L = best[1]; used.add(best[0])
                if t - L['seen'] < 0.25: shifts.append(xb - L['xb'])
                L['xb'] = 0.6 * L['xb'] + 0.4 * xb; L['slope'] = 0.6 * L['slope'] + 0.4 * slope; L['seen'] = t
            else:
                self.lines[self.next_id] = {'xb': xb, 'slope': slope, 'seen': t, 'born': t, 'hist': []}
                used.add(self.next_id); self.next_id += 1
        for k in [k for k, L in self.lines.items() if t - L['seen'] > 0.8]:
            del self.lines[k]
        # Our lane change: every painted line slides sideways together when we move
        # across the road. Add up that slide; about a lane's worth within a few
        # seconds is a lane change (lines sliding right = we moved left).
        self.slide.append((t, float(np.median(shifts)) if len(shifts) >= 1 else 0.0))
        self.slide = [x for x in self.slide if t - x[0] <= 4]
        total = sum(x[1] for x in self.slide)
        # Held for 2 s first: a jump in the paint (the wall's edge mistaken for a
        # line, then lost) slides one way and straight back, a real change stays.
        if self.pending and t - self.pending['at'] >= 2:
            back = sum(x[1] for x in self.slide if x[0] > self.pending['at'])
            if back * self.pending['sign'] > -0.4 * self.width:
                self.changes.append({'t': self.pending['t'], 'type': 'our_lane_change', 'dir': self.pending['dir']})
            self.pending = None
        if not self.pending and t - self.last_change > 4 and abs(total) > 0.6 * self.width:
            self.pending = {'t': round(t, 1), 'at': t, 'sign': 1 if total > 0 else -1, 'dir': 'left' if total > 0 else 'right'}
            self.last_change = t
            self.slide = []
        left = [L for L in self.lines.values() if L['xb'] < x0 and t - L['born'] >= 0.3]
        right = [L for L in self.lines.values() if L['xb'] > x0 and t - L['born'] >= 0.3]
        self.left = max(left, key=lambda L: L['xb'], default=None)
        self.right = min(right, key=lambda L: L['xb'], default=None)
        if self.left and self.right:
            w = self.right['xb'] - self.left['xb']
            if W * 0.25 < w < W * 1.2: self.width = 0.9 * self.width + 0.1 * w

    def bounds(self, y, t):
        frac = (y - hy) / (by - hy)
        lx = self.left['xb'] + self.left['slope'] * (y - by) if self.left else None
        rx = self.right['xb'] + self.right['slope'] * (y - by) if self.right else None
        if lx is not None and rx is not None: return lx, rx
        if lx is not None: return lx, lx + self.width * frac
        if rx is not None: return rx - self.width * frac, rx
        return x0 - self.width * frac / 2, x0 + self.width * frac / 2

    def known(self, t):
        return bool(self.left or self.right)


# ── Main loop ──────────────────────────────────────────────────────────────
lane = Lane()
dbg = []
history, leads, events = {}, [], []
stable_lead = None
frame_i = 0
lane_known_frames = 0
n_frames = 0
start_frame = int(a.start * src_fps)
while True:
    ok, frame = cap.read()
    if not ok: break
    t = a.start + frame_i / src_fps
    if a.secs and t > a.start + a.secs: break
    if frame_i % step:
        frame_i += 1; continue
    n_frames += 1
    res = model.track(frame, persist=True, classes=list(VEHICLES), verbose=False, device='mps', tracker='bytetrack.yaml')[0]
    boxes = []
    if res.boxes.id is not None:
        boxes = [(tuple(b), int(c), int(i)) for b, c, i in zip(res.boxes.xyxy.tolist(), res.boxes.cls.tolist(), res.boxes.id.tolist())]
    segs, _ = paint_segments(frame, [b for b, _, _ in boxes])
    lane.update(t, segs)
    dbg.append((round(t,1), sorted((int(L['xb'] - x0), round(t - L['born'],1)) for L in lane.lines.values())))
    if lane.known(t): lane_known_frames += 1

    lead = None
    for (x1, y1, x2, y2), cls, tid in boxes:
        name, width_m = VEHICLES[cls]
        dist = focal * width_m / max(1, x2 - x1)
        lx, rx = lane.bounds(y2, t)
        foot = (x1 + x2) / 2
        inl = y2 > hy and lx < foot < rx
        history.setdefault(tid, []).append((t, inl, dist))
        if inl and (lead is None or y2 > lead[4]):
            lead = (tid, dist, name, (x1, y1, x2, y2), y2)
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 255) if inl else (160, 160, 160), 2)

    if lead:
        leads.append((t, lead[0], lead[1]))
        x1, y1, x2, y2 = map(int, lead[3])
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 4)
        cv2.putText(frame, f'ahead ~{lead[1]:.0f} m', (x1, max(30, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 3)
    recent = [x for x in leads if t - a.stable <= x[0] <= t]
    if lead and len(recent) >= a.fps * a.stable * 0.8 and all(x[1] == lead[0] for x in recent):
        tid, dist = lead[0], lead[1]
        if stable_lead is not None and stable_lead != tid:
            entered = recent[0][0]
            we_moved = any(-4 < c['t'] - entered < 4 for c in lane.changes) or (lane.pending and abs(lane.pending['t'] - entered) < 4)
            was_out = any(not inl for (tt, inl, _) in history[tid] if entered - 2.0 <= tt < entered)
            old = [d for (tt, inl, d) in history.get(stable_lead, []) if tt >= entered - 0.5]
            if was_out and old and old[-1] > dist and dist < 40:
                kind = 'we_changed_lanes' if we_moved else 'cut_in'
                events.append({'t': round(entered, 1), 'type': kind, 'track': tid, 'dist_m': round(dist, 1),
                               'previous_lead_dist_m': round(old[-1], 1)})
        stable_lead = tid

    # draw our lane
    ys = np.linspace(ROI_TOP, by, 12)
    for side in (0, 1):
        pts = np.array([(lane.bounds(y, t)[side], y) for y in ys], np.int32)
        cv2.polylines(frame, [pts], False, (0, 255, 0) if lane.known(t) else (0, 120, 0), 3)
    cv2.line(frame, (int(x0), int(by) - 15), (int(x0), int(by) + 15), (255, 0, 255), 3)
    recent_change = [c for c in lane.changes if 0 <= t - c['t'] < 2]
    if recent_change:
        cv2.putText(frame, f"WE CHANGED LANES ({recent_change[-1]['dir']})", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 0, 255), 3)
    cut = [e for e in events if e['type'] == 'cut_in' and 0 <= t - e['t'] < 2]
    if cut:
        cv2.putText(frame, 'CUT-IN', (20, 140), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 255), 4)
    cv2.putText(frame, f't={t:5.1f}s', (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    writer.write(frame)
    frame_i += 1
writer.release()

summary = {
    'clip': os.path.basename(a.clip), 'seconds': round(frame_i / src_fps, 1),
    'lane_found_pct': round(100 * lane_known_frames / max(1, n_frames), 1),
    'frames_with_car_ahead_pct': round(100 * len(leads) / max(1, n_frames), 1),
    'median_gap_m': round(sorted(d for _, _, d in leads)[len(leads) // 2], 1) if leads else None,
    'our_lane_changes': lane.changes,
    'lead_changes': events,
}
json.dump(dbg, open(os.path.join(a.out, 'lines.json'), 'w'))
json.dump(summary, open(os.path.join(a.out, 'result.json'), 'w'), indent=1)
print(json.dumps(summary, indent=1))
