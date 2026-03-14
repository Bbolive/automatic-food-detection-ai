# GET  /api/weight

"""
routes/weight.py
─────────────────────────────────────────────────────────
Blueprint: GET /api/weight

อ่านน้ำหนักจาก HX711 load cell (Raspberry Pi)
หรือคืนค่า mock บน PC

แก้ไขที่นี่เมื่อ:
  - เพิ่ม endpoint สำหรับ tare (归零)
  - เปลี่ยน unit (กรัม → กิโลกรัม)
─────────────────────────────────────────────────────────
"""

import logging
from flask import Blueprint, jsonify
from hardware.loadcell import LoadCell

logger    = logging.getLogger(__name__)
weight_bp = Blueprint("weight", __name__, url_prefix="/api")

# LoadCell instance (สร้างครั้งเดียว)
_loadcell = LoadCell()


@weight_bp.route("/weight", methods=["GET"])
def get_weight():
    """
    GET /api/weight
    อ่านน้ำหนักปัจจุบัน

    Response:
        { "success": true, "weight": 250.5, "unit": "grams" }
    """
    weight = _loadcell.read_grams()
    return jsonify({
        "success": True,
        "weight":  weight,
        "unit":    "grams",
    })


@weight_bp.route("/weight/tare", methods=["POST"])
def tare_scale():
    """
    POST /api/weight/tare
    รีเซ็ตน้ำหนักเป็น 0 (tare /归零)

    Response:
        { "success": true, "message": "Tared" }
    """
    ok = _loadcell.tare()
    if ok:
        return jsonify({"success": True, "message": "Tared successfully"})
    return jsonify({"success": False, "message": "Tare not supported in mock mode"})