"""YOLOP (MIT, hustvl/YOLOP) run from its ONNX file: vehicles, drivable road and lane
lines in one pass. Trained on BDD100K, 100k real dash cam videos including rain and
night. Own pre/post-processing, so no third-party code runs, only the ONNX graph."""
import cv2
import numpy as np
import onnxruntime as ort

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


class Yolop:
    def __init__(self, path, size=640):
        ort.set_default_logger_severity(3)
        self.s = ort.InferenceSession(path, providers=['CoreMLExecutionProvider', 'CPUExecutionProvider'])
        self.size = size

    def __call__(self, bgr, conf=0.35, iou=0.45):
        """Returns (boxes [(x1,y1,x2,y2,conf)], road mask, lane mask) in the frame's own pixels."""
        h, w = bgr.shape[:2]
        r = min(self.size / h, self.size / w)
        nw, nh = int(round(w * r)), int(round(h * r))
        dw, dh = (self.size - nw) // 2, (self.size - nh) // 2
        canvas = np.full((self.size, self.size, 3), 114, np.float32)
        canvas[dh:dh + nh, dw:dw + nw] = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA)[:, :, ::-1]
        x = ((canvas / 255.0 - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        det, da, ll = self.s.run(['det_out', 'drive_area_seg', 'lane_line_seg'], {'images': x})
        d = det[0]
        score = d[:, 4] * d[:, 5]
        keep = score > conf
        d, score = d[keep], score[keep]
        boxes = []
        if len(d):
            xywh = np.stack([d[:, 0] - d[:, 2] / 2, d[:, 1] - d[:, 3] / 2, d[:, 2], d[:, 3]], 1)
            idx = cv2.dnn.NMSBoxes(xywh.tolist(), score.tolist(), conf, iou)
            for i in np.array(idx).reshape(-1):
                x1, y1, bw, bh = xywh[i]
                boxes.append(((x1 - dw) / r, (y1 - dh) / r, (x1 + bw - dw) / r, (y1 + bh - dh) / r, float(score[i])))
        def mask(seg):
            m = np.argmax(seg[0, :, dh:dh + nh, dw:dw + nw], 0).astype(np.uint8)
            return cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
        return boxes, mask(da), mask(ll)
