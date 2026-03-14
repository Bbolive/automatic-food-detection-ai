"""
app.py
─────────────────────────────────────────────────────────
จุดเริ่มต้นของ Flask application

ไฟล์นี้ทำแค่:
  1. สร้าง Flask app
  2. ลงทะเบียน Blueprints ทั้งหมด
  3. ตั้งค่า error handlers กลาง
  4. เริ่ม server

แก้ไขที่นี่เมื่อ:
  - เพิ่ม Blueprint ใหม่
  - เพิ่ม middleware (CORS, auth ฯลฯ)
  - เปลี่ยน error response format
─────────────────────────────────────────────────────────
"""

import logging
from flask import Flask, jsonify, render_template, send_from_directory
from flask_cors import CORS

from config import ServerConfig, DB_PATH, UPLOAD_DIR
from database import init_db
from detector import FoodDetector
from utils import setup_logging, cleanup_old_files

# Blueprints
from routes.detection import detection_bp
from routes.weight    import weight_bp
from routes.history   import history_bp
from routes.status    import status_bp

# ── ตั้งค่า Logging ────────────────────────────────────────
setup_logging("food_ai")
logger = logging.getLogger(__name__)


# ── สร้าง App ──────────────────────────────────────────────

def create_app() -> Flask:
    """
    Application Factory Pattern
    แยกการสร้าง app เป็นฟังก์ชัน ทำให้ test ง่ายขึ้น
    """
    app = Flask(__name__)

    # ── ตั้งค่า ────────────────────────────────────────────
    app.config["SECRET_KEY"]             = ServerConfig.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"]     = ServerConfig.MAX_UPLOAD_MB * 1024 * 1024
    app.config["UPLOAD_FOLDER"]          = str(UPLOAD_DIR)
    app.config["DB_PATH"]                = str(DB_PATH)

    # ── CORS (อนุญาตทุก origin สำหรับ touchscreen local) ───
    CORS(app)

    # ── เตรียม Database ────────────────────────────────────
    init_db(str(DB_PATH))

    # ── สร้าง Detector ─────────────────────────────────────
    # เก็บ instance เดียวใน app context เพื่อประหยัด memory
    app.detector = FoodDetector()

    # ── ลงทะเบียน Blueprints ──────────────────────────────
    app.register_blueprint(status_bp)
    app.register_blueprint(detection_bp)
    app.register_blueprint(weight_bp)
    app.register_blueprint(history_bp)

    # ── Routes หลัก (/, /favicon.ico) ────────────────────
    register_main_routes(app)

    # ── Error Handlers กลาง ───────────────────────────────
    register_error_handlers(app)

    # ── ล้างไฟล์เก่าตอนเริ่ม ─────────────────────────────
    cleanup_old_files(UPLOAD_DIR)

    logger.info("App created | mode=%s | db=%s",
                "debug" if ServerConfig.DEBUG else "production", DB_PATH)
    return app



def register_main_routes(app: Flask) -> None:
    """Route หลัก — serve UI และ static files"""

    @app.route("/")
    def index():
        """หน้าหลัก — serve touchscreen UI"""
        return render_template("index.html")

    @app.route("/history")
    def history_page():
        """หน้า Admin — ดูประวัติการตรวจจับ"""
        return render_template("history.html")

    @app.route("/favicon.ico")
    def favicon():
        """ป้องกัน 404 จาก browser request favicon"""
        return send_from_directory(
            app.static_folder, "favicon.ico",
            mimetype="image/vnd.microsoft.icon"
        ) if (app.static_folder and
              __import__("os").path.exists(
                  __import__("os").path.join(app.static_folder, "favicon.ico")
              )) else ("", 204)

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        """serve ภาพที่อัปโหลด — ใช้ใน debug เท่านั้น"""
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

def register_error_handlers(app: Flask) -> None:
    """ลงทะเบียน error handlers กลาง — ทุก route ใช้ร่วมกัน"""

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"success": False, "error": "Bad request", "detail": str(e)}), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"success": False, "error": "Not found"}), 404

    @app.errorhandler(413)
    def file_too_large(e):
        return jsonify({"success": False,
                        "error": f"File too large (max {ServerConfig.MAX_UPLOAD_MB} MB)"}), 413

    @app.errorhandler(500)
    def internal_error(e):
        logger.exception("Internal server error")
        return jsonify({"success": False, "error": "Internal server error"}), 500

    @app.errorhandler(Exception)
    def unhandled_exception(e):
        logger.exception("Unhandled exception")
        return jsonify({"success": False, "error": str(e)}), 500


# ── Entry Point ────────────────────────────────────────────

app = create_app()

if __name__ == "__main__":
    app.run(
        host=ServerConfig.HOST,
        port=ServerConfig.PORT,
        debug=ServerConfig.DEBUG,
    )