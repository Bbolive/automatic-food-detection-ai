from flask import Blueprint, jsonify, current_app
import logging

logger = logging.getLogger(__name__)

camera_bp = Blueprint("camera", __name__, url_prefix="/api")


@camera_bp.route("/capture", methods=["POST"])
def capture():

    camera = current_app.camera   # ✅ ใช้ตัวเดียวกับ app

    if not camera or not camera.is_active:
        return jsonify({
            "success": False,
            "error": "Camera not active"
        }), 400

    path = camera.capture()

    if not path:
        return jsonify({
            "success": False,
            "error": "capture failed"
        }), 500

    filename = path.split("/")[-1]

    return jsonify({
        "success": True,
        "filename": filename,
        "image_url": f"/uploads/{filename}"
    })