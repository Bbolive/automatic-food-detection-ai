"""
app.py
─────────────────────────────────────────────────────────
จุดเริ่มต้นของ Flask application
...
─────────────────────────────────────────────────────────
"""

import logging
import time                                               # ← เพิ่ม
import os                                                 # ← เพิ่ม
from flask import Flask, jsonify, render_template, send_from_directory, Response, request  # ← เพิ่ม Response, request
from flask_cors import CORS

from config import ServerConfig, DB_PATH, UPLOAD_DIR
from database import init_db
from detector import FoodDetector
from utils import setup_logging, cleanup_old_files
from hardware.camera import PiCamera

from routes.detection import detection_bp
from routes.weight    import weight_bp
from routes.history   import history_bp
from routes.status    import status_bp
from routes.camera    import camera_bp

setup_logging("food_ai")
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__)

    app.config["SECRET_KEY"]         = ServerConfig.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = ServerConfig.MAX_UPLOAD_MB * 1024 * 1024
    app.config["UPLOAD_FOLDER"]      = str(UPLOAD_DIR)
    app.config["DB_PATH"]            = str(DB_PATH)

    CORS(app)
    init_db(str(DB_PATH))

    app.detector = FoodDetector()
    app.camera   = PiCamera()

    app.register_blueprint(status_bp)
    app.register_blueprint(detection_bp)
    app.register_blueprint(weight_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(camera_bp)

    register_main_routes(app)
    register_error_handlers(app)
    cleanup_old_files(UPLOAD_DIR)

    logger.info("App created | mode=%s | db=%s",
                "debug" if ServerConfig.DEBUG else "production", DB_PATH)
    return app


def register_main_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/history")
    def history_page():
        return render_template("history.html")

    # ── Camera Stream ──────────────────────────────────────── ← เพิ่ม
    @app.route("/video_feed")
    def video_feed():
        def generate():
            while True:
                frame = app.camera.get_frame()
                if frame:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                time.sleep(0.1)
        return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

    # ── Capture ────────────────────────────────────────────── ← เพิ่ม
    @app.route("/api/capture", methods=["POST"])
    def capture_api():
        path = app.camera.capture()
        if path:
            filename = os.path.basename(path)
            return jsonify({
                "success":   True,
                "filename":  filename,
                "image_url": f"/uploads/{filename}?t={int(time.time())}"
            })
        return jsonify({"success": False, "error": "Camera Busy"}), 500

    # ── Detect ─────────────────────────────────────────────── ← เพิ่ม
    @app.route("/api/detect-captured", methods=["POST"])
    def detect_api():
        data     = request.get_json()
        filename = data.get("filename")
        if not filename:
            return jsonify({"success": False, "error": "No file"}), 400

        image_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        result     = app.detector.detect(image_path)

        return jsonify({
            "success":          True,
            "total_price":      result.get("total_price", 0),
            "annotated_image":  f"/uploads/annotated_{filename}?t={int(time.time())}",
            "dishes":           result.get("detections", []),
            "pending_file":     filename
        })

    @app.route("/favicon.ico")
    def favicon():
        return send_from_directory(
            app.static_folder, "favicon.ico",
            mimetype="image/vnd.microsoft.icon"
        ) if (app.static_folder and
              __import__("os").path.exists(
                  __import__("os").path.join(app.static_folder, "favicon.ico")
              )) else ("", 204)

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


def register_error_handlers(app: Flask) -> None:

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


app = create_app()

if __name__ == "__main__":
    app.run(
        host=ServerConfig.HOST,
        port=ServerConfig.PORT,
        debug=ServerConfig.DEBUG,
    )