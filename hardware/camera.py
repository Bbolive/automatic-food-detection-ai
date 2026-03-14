"""
hardware/camera.py
─────────────────────────────────────────────────────────
PiCamera2 wrapper สำหรับ Raspberry Pi

โหมดการทำงาน:
  - บน Pi ที่มี picamera2 → ใช้กล้องจริง
  - บน PC / ไม่มี library  → is_active = False (mock)

แก้ไขที่นี่เมื่อ:
  - เปลี่ยน resolution
  - เปลี่ยนรุ่น camera module
  - ปรับ exposure / white balance
─────────────────────────────────────────────────────────
"""

import logging
import uuid
from pathlib import Path

from config import UPLOAD_DIR, HardwareConfig

logger = logging.getLogger(__name__)

# ลอง import picamera2 (จะล้มเหลวบน PC — ไม่เป็นไร)
try:
    from picamera2 import Picamera2
    _HAS_PICAMERA = True
except ImportError:
    _HAS_PICAMERA = False
    logger.info("picamera2 not available — camera disabled")


class PiCamera:
    """
    Wrapper สำหรับ PiCamera2
    ถ้าไม่มี library จะเป็น no-op (ไม่ crash)
    """

    def __init__(self):
        self._cam = None
        if _HAS_PICAMERA:
            try:
                self._cam = Picamera2()
                cfg = self._cam.create_still_configuration(
                    main={"size": HardwareConfig.CAMERA_RESOLUTION,
                          "format": HardwareConfig.CAMERA_FORMAT}
                )
                self._cam.configure(cfg)
                self._cam.start()
                logger.info("PiCamera2 started | resolution=%s",
                            HardwareConfig.CAMERA_RESOLUTION)
            except Exception as exc:
                logger.error("PiCamera2 init failed: %s", exc)
                self._cam = None

    @property
    def is_active(self) -> bool:
        """True ถ้ากล้องพร้อมใช้งาน"""
        return self._cam is not None

    def capture(self) -> str | None:
        """
        ถ่ายภาพและบันทึกลง uploads/
        คืน path ของไฟล์ หรือ None ถ้ากล้องไม่พร้อม
        """
        if not self._cam:
            logger.warning("capture() called but camera not active")
            return None
        try:
            filename = f"capture_{uuid.uuid4().hex}.jpg"
            path     = str(UPLOAD_DIR / filename)
            self._cam.capture_file(path)
            logger.debug("Captured: %s", path)
            return path
        except Exception as exc:
            logger.error("Capture failed: %s", exc)
            return None

    def stop(self) -> None:
        """หยุดกล้อง (เรียกตอนปิด app)"""
        if self._cam:
            try:
                self._cam.stop()
                logger.info("PiCamera2 stopped")
            except Exception:
                pass
