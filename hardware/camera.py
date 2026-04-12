import logging
import uuid
import os
import subprocess
from pathlib import Path
from config import UPLOAD_DIR

logger = logging.getLogger(__name__)


class PiCamera:
    def __init__(self):
        # ล้างโปรเซสกล้องที่ค้างอยู่
        os.system("sudo pkill -9 rpicam")
        os.system("sudo pkill -9 libcamera")
        if not os.path.exists(UPLOAD_DIR):
            os.makedirs(UPLOAD_DIR, exist_ok=True)
        logger.info("✅ PiCamera (rpicam mode) Ready")

    @property
    def is_active(self) -> bool:
        return True

    def get_frame(self):
        """ดึงภาพสด (Stream) ลง RAM"""
        try:
            cmd = [
                "rpicam-still",
                "-t",
                "1",
                "--width",
                "640",
                "--height",
                "480",
                "-e",
                "jpg",
                "-o",
                "/dev/shm/live.jpg",
                "--immediate",
                "--nopreview",
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.exists("/dev/shm/live.jpg"):
                with open("/dev/shm/live.jpg", "rb") as f:
                    return f.read()
            return None
        except Exception:
            return None

    def capture(self) -> str | None:
        """ถ่ายภาพนิ่ง (Snapshot)"""
        try:
            filename = f"capture_{uuid.uuid4().hex}.jpg"
            path = str(UPLOAD_DIR / filename)
            # ใช้ rpicam-still ถ่ายภาพจริง
            cmd = ["rpicam-still", "-t", "1", "-o", path, "--immediate", "--nopreview"]
            subprocess.run(cmd, check=True)
            return path
        except Exception as exc:
            logger.error(f"Capture failed: {exc}")
            return None
