"""
detector.py
─────────────────────────────────────────────────────────
Logic การตรวจจับอาหารด้วย YOLOv8

โหมดการทำงาน:
  1. YOLO mode  → ถ้ามี models/best.pt และติดตั้ง ultralytics
  2. Mock mode  → ถ้าไม่มีโมเดล (ใช้ทดสอบบน PC)

หมายเหตุ:
  ใช้ Pillow วาดข้อความภาษาไทยบน bounding box
  เพราะ cv2.putText() ไม่รองรับ Unicode / ภาษาไทย

แก้ไขที่นี่เมื่อ:
  - ปรับ threshold หรือ post-processing
  - เปลี่ยนขนาด / สี label
  - เพิ่ม preprocessing ภาพ
─────────────────────────────────────────────────────────
"""

import uuid
import logging
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import MODEL_PATH, UPLOAD_DIR, DetectionConfig, MENU_PATH
from utils import load_menu

logger = logging.getLogger(__name__)

# ── สีของ bounding box (RGB สำหรับ Pillow) ────────────────
BOX_COLORS_RGB = [
    (0,  229, 160),   # เขียว
    (0,  153, 255),   # น้ำเงิน
    (255, 107,  53),  # ส้ม
    (176, 106, 255),  # ม่วง
    (255, 210,  63),  # เหลือง
    (53,  211, 255),  # ฟ้า
]

# ── ฟอนต์ภาษาไทย ──────────────────────────────────────────
# ลำดับความสำคัญ: หาฟอนต์แรกที่มีในระบบ
_FONT_CANDIDATES = [
    # Raspberry Pi OS / Debian
    "/usr/share/fonts/opentype/tlwg/Loma.otf",
    "/usr/share/fonts/truetype/tlwg/Loma.ttf",
    "/usr/share/fonts/opentype/tlwg/Garuda.otf",
    "/usr/share/fonts/truetype/thai/Garuda.ttf",
    # Ubuntu / Noto
    "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    # macOS
    "/Library/Fonts/Thonburi.ttf",
    "/System/Library/Fonts/Supplemental/Ayuthaya.ttf",
    # Windows
    "C:/Windows/Fonts/tahoma.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

def _find_thai_font(size: int = 18) -> ImageFont.FreeTypeFont:
    """หาฟอนต์ที่รองรับภาษาไทย คืน default ถ้าไม่พบ"""
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            try:
                logger.debug("Using font: %s", path)
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    logger.warning("No Thai font found — using PIL default (Thai may not display)")
    return ImageFont.load_default()


class FoodDetector:
    """
    ตรวจจับอาหารจากภาพ
    ใช้ YOLOv8 ถ้ามี best.pt / ใช้ mock ถ้าไม่มี
    """

    def __init__(self):
        self.menu    = load_menu(MENU_PATH)
        self.model   = self._load_model()
        self._is_pi  = self._detect_raspberry_pi()
        # โหลดฟอนต์ครั้งเดียวตอน init
        self._font_label = _find_thai_font(size=18)
        self._font_small = _find_thai_font(size=14)
        logger.info(
            "FoodDetector ready | model=%s | pi=%s",
            "YOLO" if self.model else "mock",
            self._is_pi,
        )

    # ── Initialisation ────────────────────────────────────

    def _load_model(self):
        """โหลด YOLOv8 model ถ้ามีไฟล์และ library"""
        if not MODEL_PATH.exists():
            logger.warning("best.pt not found → mock mode")
            return None
        try:
            from ultralytics import YOLO
            model = YOLO(str(MODEL_PATH))
            logger.info("YOLOv8 loaded: %s", MODEL_PATH)
            return model
        except ImportError:
            logger.warning("ultralytics not installed → mock mode")
            return None
        except Exception as exc:
            logger.error("Model load failed: %s", exc)
            return None

    def _detect_raspberry_pi(self) -> bool:
        try:
            return "raspberry" in Path("/proc/device-tree/model").read_text().lower()
        except Exception:
            return False

    # ── Public API ────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "model_loaded":    self.model is not None,
            "is_raspberry_pi": self._is_pi,
            "platform":        "Raspberry Pi 5" if self._is_pi else "Development PC",
            "mode":            "yolo" if self.model else "mock",
        }

    def detect(self, image_path: str) -> dict:
        if not Path(image_path).exists():
            return {"success": False, "error": f"Image not found: {image_path}"}
        return self._detect_yolo(image_path) if self.model else self._detect_mock(image_path)

    # ── YOLO Detection ────────────────────────────────────

    def _detect_yolo(self, image_path: str) -> dict:
        try:
            results = self.model(
                image_path,
                conf=DetectionConfig.CONFIDENCE,
                iou=DetectionConfig.IOU_THRESHOLD,
                imgsz=DetectionConfig.IMG_SIZE,
                max_det=DetectionConfig.MAX_DETECTIONS,
            )[0]

            # โหลดภาพเป็น PIL Image (รองรับ Unicode)
            pil_img = Image.open(image_path).convert("RGB")
            detections = []

            for i, box in enumerate(results.boxes):
                cls_id = int(box.cls[0])
                conf   = float(box.conf[0])
                label  = results.names[cls_id]
                x1, y1, x2, y2 = map(int, box.xyxy[0])

                menu_item = self.menu.get(label, self.menu.get("unknown", {}))
                det = {
                    "name":       label,
                    "name_th":    menu_item.get("name_th", label),
                    "name_en":    menu_item.get("name_en", label),
                    "confidence": round(conf, 3),
                    "price":      menu_item.get("price", 0),
                    "weight":     0.0,
                    "bbox":       {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                }
                detections.append(det)
                self._draw_box_pil(pil_img, det, i)

            annotated_path = self._save_annotated_pil(pil_img, image_path)
            out = {
                "success":        True,
                "detections":     detections,
                "total_price":    sum(d["price"] for d in detections),
                "annotated_path": annotated_path,
                "mock":           False,
            }
            out["menus"] = self._build_menus_hierarchy(detections)
            return out
        except Exception as exc:
            logger.exception("YOLO detection error")
            return {"success": False, "error": str(exc)}

    # ── Mock Detection ────────────────────────────────────

    def _detect_mock(self, image_path: str) -> dict:
        pil_img = Image.open(image_path).convert("RGB")
        if pil_img is None:
            return {"success": False, "error": "Cannot read image"}

        w, h = pil_img.size
        keys   = [k for k in self.menu if k != "unknown"]
        chosen = random.sample(keys, k=min(random.randint(1, 3), len(keys)))

        detections = []
        cols = len(chosen)
        for i, key in enumerate(chosen):
            item = self.menu[key]
            conf = round(random.uniform(0.72, 0.97), 3)
            bw   = w // cols
            x1   = i * bw + int(bw * 0.06)
            x2   = (i + 1) * bw - int(bw * 0.06)
            y1   = int(h * 0.08)
            y2   = int(h * 0.92)

            det = {
                "name":       key,
                "name_th":    item.get("name_th", key),
                "name_en":    item.get("name_en", key),
                "confidence": conf,
                "price":      item.get("price", 0),
                "weight":     round(random.uniform(80, 350), 1),
                "bbox":       {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            }
            detections.append(det)
            self._draw_box_pil(pil_img, det, i)

        annotated_path = self._save_annotated_pil(pil_img, image_path)
        out = {
            "success":        True,
            "detections":     detections,
            "total_price":    sum(d["price"] for d in detections),
            "annotated_path": annotated_path,
            "mock":           True,
        }
        out["menus"] = self._build_menus_hierarchy(detections)
        return out

    # ── Menu hierarchy (เมนูหลัก + วัตถุดิบจาก bbox) ─────

    @staticmethod
    def _bbox_area(b: dict) -> float:
        w = max(0, b.get("x2", 0) - b.get("x1", 0))
        h = max(0, b.get("y2", 0) - b.get("y1", 0))
        return w * h

    @staticmethod
    def _bbox_center(b: dict) -> tuple[float, float]:
        x1, y1 = b.get("x1", 0), b.get("y1", 0)
        x2, y2 = b.get("x2", 0), b.get("y2", 0)
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    @classmethod
    def _build_menus_hierarchy(cls, detections: list[dict]) -> list[dict]:
        """
        จัดกลุ่ม detection เป็นเมนูหลัก + วัตถุดิบ จาก bbox
        - bbox ที่มี bbox อื่นอยู่ภายใน = เมนูหลัก
        - bbox ที่อยู่ภายในเมนูหลัก = วัตถุดิบของเมนูนั้น
        รองรับหลายจาน (หลายเมนู) ในภาพเดียว
        """
        if not detections:
            return []

        # หา parent ของแต่ละตัว: detection ที่มีพื้นที่ใหญ่กว่าและครอบ center ของตัวนี้
        def contains(outer: dict, inner: dict) -> bool:
            ob = outer.get("bbox") or {}
            ib = inner.get("bbox") or {}
            cx, cy = cls._bbox_center(ib)
            x1, y1 = ob.get("x1", 0), ob.get("y1", 0)
            x2, y2 = ob.get("x2", 0), ob.get("y2", 0)
            if x1 >= x2 or y1 >= y2:
                return False
            return x1 <= cx <= x2 and y1 <= cy <= y2

        # parent[i] = index ของ detection ที่เป็น parent ของ detections[i] (หรือ None ถ้าเป็นเมนูหลัก)
        parent_idx = [None] * len(detections)
        areas = [cls._bbox_area(d.get("bbox") or {}) for d in detections]

        for i, det in enumerate(detections):
            candidates = [
                j for j in range(len(detections))
                if j != i and areas[j] > areas[i] and contains(detections[j], det)
            ]
            if candidates:
                # เลือก parent ที่เล็กที่สุดที่ยังครอบได้ (เมนูที่ใกล้ที่สุด)
                parent_idx[i] = min(candidates, key=lambda j: areas[j])

        # เมนูหลัก = ไม่มี parent
        root_indices = [i for i in range(len(detections)) if parent_idx[i] is None]
        # เรียงตามตำแหน่งบนภาพ (y แล้ว x)
        root_indices.sort(
            key=lambda i: (
                (detections[i].get("bbox") or {}).get("y1", 0),
                (detections[i].get("bbox") or {}).get("x1", 0),
            )
        )

        menus = []
        for ri in root_indices:
            det = detections[ri]
            children = [j for j in range(len(detections)) if parent_idx[j] == ri]
            ingredients = [
                {
                    "name": detections[j].get("name", ""),
                    "name_th": detections[j].get("name_th", ""),
                    "name_en": detections[j].get("name_en", ""),
                    "confidence": detections[j].get("confidence", 0),
                    "price": 0,  # ราคาวัตถุดิบไม่นำมารวม
                }
                for j in children
            ]
            # ความแม่นยำเมนูหลัก = ค่าเฉลี่ยของเมนู + วัตถุดิบ
            confs = [det.get("confidence", 0)] + [detections[j].get("confidence", 0) for j in children]
            accuracy_avg = sum(confs) / len(confs) if confs else 0
            menus.append({
                "name": det.get("name", ""),
                "name_th": det.get("name_th", det.get("name", "")),
                "name_en": det.get("name_en", ""),
                "confidence": det.get("confidence", 0),
                "accuracy_avg": round(accuracy_avg, 3),
                "price": det.get("price", 0),
                "weight": det.get("weight", 0.0),
                "ingredients": ingredients,
            })
        return menus

    # ── Drawing (Pillow — รองรับภาษาไทย) ─────────────────

    def _draw_box_pil(self, img: Image.Image, det: dict, idx: int) -> None:
        """
        วาด bounding box + label ภาษาไทยด้วย Pillow
        ทำงานบน PIL Image โดยตรง (in-place)
        """
        color = BOX_COLORS_RGB[idx % len(BOX_COLORS_RGB)]
        bbox  = det["bbox"]
        x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]

        pct  = int(det["confidence"] * 100)
        text = f"{det['name_th']}  {pct}%  ฿{det['price']}"

        draw = ImageDraw.Draw(img)

        # ── วาดกรอบ bounding box ──────────────────────────
        for t in range(2):   # ความหนา 2px (วาดซ้อน)
            draw.rectangle(
                [x1 - t, y1 - t, x2 + t, y2 + t],
                outline=color,
            )

        # ── คำนวณขนาด label ──────────────────────────────
        bbox_text = self._font_label.getbbox(text)
        tw = bbox_text[2] - bbox_text[0]
        th = bbox_text[3] - bbox_text[1]
        pad_x, pad_y = 8, 5

        # ตำแหน่งแท็ก — ถ้าพื้นที่บนไม่พอ ให้ไปอยู่ด้านล่างแทน
        label_y_top    = y1 - th - pad_y * 2
        label_y_bottom = y2

        if label_y_top < 0:
            tag_y1 = label_y_bottom
            tag_y2 = label_y_bottom + th + pad_y * 2
            text_y = label_y_bottom + pad_y
        else:
            tag_y1 = label_y_top
            tag_y2 = y1
            text_y = label_y_top + pad_y

        tag_x1 = x1
        tag_x2 = x1 + tw + pad_x * 2

        # ── วาดพื้นหลัง label ────────────────────────────
        draw.rectangle([tag_x1, tag_y1, tag_x2, tag_y2], fill=color)

        # ── วาดข้อความ (สีดำ อ่านง่ายบนทุกสีพื้นหลัง) ───
        draw.text(
            (tag_x1 + pad_x, text_y),
            text,
            font=self._font_label,
            fill=(0, 0, 0),
        )

    @staticmethod
    def _save_annotated_pil(img: Image.Image, original_path: str) -> str:
        """บันทึก PIL Image เป็น JPEG คืน path"""
        p   = Path(original_path)
        out = p.parent / f"annotated_{p.stem}.jpg"
        img.save(str(out), "JPEG", quality=92)
        return str(out)