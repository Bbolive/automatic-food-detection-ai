# POST /api/detect

"""
routes/detection.py
─────────────────────────────────────────────────────────
Blueprint: POST /api/detect

รับภาพ 2 แบบ:
  1. multipart/form-data  → field "image" (file)
  2. application/json     → field "image" (base64 string)

ขั้นตอน:
  1. รับและ validate ภาพ
  2. บันทึกลง uploads/
  3. ส่งให้ detector วิเคราะห์
  4. บันทึกผลลง database
  5. คืน JSON + annotated image (base64)

แก้ไขที่นี่เมื่อ:
  - เปลี่ยน format ของ response
  - เพิ่ม field ใหม่ใน request
─────────────────────────────────────────────────────────
"""

import base64
import logging
import uuid
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request

from config import UPLOAD_DIR
from database import save_detection_record
from utils import allowed_file

logger       = logging.getLogger(__name__)
detection_bp = Blueprint("detection", __name__, url_prefix="/api")


@detection_bp.route("/detect", methods=["POST"])
def detect_food():
    """
    POST /api/detect

    Form-data fields:
        image  (file)   ← ภาพอาหาร (jpg/png/webp)
        weight (float)  ← น้ำหนักจาก load cell (optional)

    JSON fields:
        image  (str)    ← base64 encoded image
        weight (float)  ← น้ำหนัก (optional)
    """
    try:
        image_path, filename = _get_image_from_request()
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    # น้ำหนักจาก form หรือ JSON (optional)
    weight = _get_weight_from_request()

    # วิเคราะห์อาหาร
    detector = current_app.detector
    result   = detector.detect(str(image_path))

    if not result["success"]:
        return jsonify(result), 500

    # อัปเดตน้ำหนักแต่ละ item ถ้ามีข้อมูล
    if weight and result["detections"]:
        per_item = round(weight / len(result["detections"]), 1)
        for det in result["detections"]:
            det["weight"] = per_item

    # บันทึกลง database
    db_path    = current_app.config["DB_PATH"]
    session_id = save_detection_record(
        db_path=db_path,
        image_path=filename,
        detections=result["detections"],
        total_price=result["total_price"],
        weight=weight,
    )
    result["session_id"] = session_id

    # แนบ annotated image เป็น base64 เพื่อแสดงใน browser
    annotated = Path(result.get("annotated_path", ""))
    if annotated.exists():
        result["annotated_image"] = (
            "data:image/jpeg;base64,"
            + base64.b64encode(annotated.read_bytes()).decode()
        )

    # ไม่ส่ง path ภายในเซิร์ฟเวอร์กลับไป
    result.pop("annotated_path", None)

    logger.info("Detection done | session=%d | items=%d | total=%.0f",
                session_id, len(result["detections"]), result["total_price"])
    return jsonify(result)


# ── Private helpers ────────────────────────────────────────

def _get_image_from_request() -> tuple[Path, str]:
    """
    ดึงไฟล์ภาพจาก request (form-data หรือ JSON base64)
    คืน (path_ของไฟล์ที่บันทึกแล้ว, ชื่อไฟล์)
    Raises ValueError ถ้าไม่มีภาพหรือภาพไม่ valid
    """
    # ── แบบ 1: multipart file upload
    if "image" in request.files:
        file = request.files["image"]
        if not file.filename:
            raise ValueError("No file selected")
        if not allowed_file(file.filename):
            raise ValueError(f"File type not allowed: {file.filename}")
        ext      = Path(file.filename).suffix.lower()
        filename = f"{uuid.uuid4().hex}{ext}"
        path     = UPLOAD_DIR / filename
        file.save(str(path))
        return path, filename

    # ── แบบ 2: JSON base64
    if request.is_json:
        body = request.get_json(silent=True) or {}
        b64  = body.get("image", "")
        if not b64:
            raise ValueError("No image data in JSON")
        # ลบ data URI prefix ถ้ามี
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64)
        except Exception:
            raise ValueError("Invalid base64 image data")
        filename = f"{uuid.uuid4().hex}.jpg"
        path     = UPLOAD_DIR / filename
        path.write_bytes(raw)
        return path, filename

    raise ValueError("No image provided (use multipart/form-data or JSON base64)")


def _get_weight_from_request() -> float:
    """ดึงน้ำหนักจาก request (form หรือ JSON) คืน 0.0 ถ้าไม่มี"""
    try:
        if request.form.get("weight"):
            return float(request.form["weight"])
        if request.is_json:
            return float((request.get_json(silent=True) or {}).get("weight", 0))
    except (TypeError, ValueError):
        pass
    return 0.0