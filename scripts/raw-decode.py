#!/usr/bin/env python3
"""Decode raw motion chunks (.bin, from services/sensors/rawCapture.js) to CSV.

Usage: scripts/raw-decode.py <chunk.bin or a folder of them> > drive.csv
Columns: t_ms (since drive start), ax ay az gx gy gz (m/s²), ra rb rg (deg/s).
"""
import glob, os, struct, sys

ACCEL, GYRO = 500.0, 10.0
HEADER, ROW = 32, 20


def rows(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, count, _idx, t0, start = struct.unpack_from("<4sIIIdd", data, 0)
    if magic != b"SAFR" or version != 1:
        raise SystemExit(f"{path}: not a v1 raw motion chunk")
    t = t0 - start
    for i in range(count):
        dt, *v = struct.unpack_from("<H9h", data, HEADER + i * ROW)
        t += dt
        yield [round(t)] + [round(x / ACCEL, 3) for x in v[:6]] + [round(x / GYRO, 1) for x in v[6:]]


def main():
    target = sys.argv[1]
    paths = sorted(glob.glob(os.path.join(target, "*.bin"))) if os.path.isdir(target) else [target]
    print("t_ms,ax,ay,az,gx,gy,gz,ra,rb,rg")
    for p in paths:
        for r in rows(p):
            print(",".join(map(str, r)))


if __name__ == "__main__":
    main()
