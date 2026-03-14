"""
hardware/loadcell.py
─────────────────────────────────────────────────────────
HX711 Load Cell wrapper สำหรับ Raspberry Pi

โหมดการทำงาน:
  - บน Pi ที่มี RPi.GPIO + hx711 → อ่านน้ำหนักจริง
  - บน PC / ไม่มี library        → คืนค่า 0.0

วงจร HX711 → RPi GPIO:
  VCC  → 3.3V  (Pin 1)
  GND  → GND   (Pin 6)
  DT   → GPIO5 (Pin 29)  ← เปลี่ยนได้ใน config.py
  SCK  → GPIO6 (Pin 31)  ← เปลี่ยนได้ใน config.py

แก้ไขที่นี่เมื่อ:
  - ปรับ scale ratio (calibrate)
  - เพิ่ม tare logic
─────────────────────────────────────────────────────────
"""

import logging
from config import HardwareConfig

logger = logging.getLogger(__name__)

# ลอง import GPIO libraries (จะล้มเหลวบน PC)
try:
    import RPi.GPIO as GPIO
    from hx711 import HX711
    _HAS_HX711 = True
except ImportError:
    _HAS_HX711 = False
    logger.info("HX711/GPIO not available — load cell disabled (mock mode)")


class LoadCell:
    """
    Wrapper สำหรับ HX711 load cell
    ถ้าไม่มี hardware จะคืน 0.0 เสมอ
    """

    def read_grams(self) -> float:
        """
        อ่านน้ำหนักปัจจุบัน

        Returns:
            น้ำหนักในหน่วยกรัม (float)
            คืน 0.0 ถ้าไม่มี hardware หรือเกิดข้อผิดพลาด
        """
        if not _HAS_HX711:
            return 0.0          # mock mode — คืน 0 บน PC
        try:
            hx = HX711(
                dout_pin  = HardwareConfig.HX711_DOUT_PIN,
                pd_sck_pin= HardwareConfig.HX711_SCK_PIN,
            )
            hx.set_scale_ratio(HardwareConfig.HX711_SCALE)
            hx.tare()                                      # ล้างค่าเริ่มต้น
            raw = hx.get_weight_mean(HardwareConfig.HX711_READINGS)
            return round(max(raw, 0.0), 1)                 # ป้องกันค่าติดลบ
        except Exception as exc:
            logger.error("HX711 read failed: %s", exc)
            return 0.0
        finally:
            # ต้อง cleanup GPIO ทุกครั้ง
            try:
                GPIO.cleanup()
            except Exception:
                pass

    def tare(self) -> bool:
        """
        รีเซ็ตน้ำหนักเป็น 0
        คืน True ถ้าสำเร็จ, False ถ้าไม่มี hardware
        """
        if not _HAS_HX711:
            return False
        try:
            hx = HX711(
                dout_pin  = HardwareConfig.HX711_DOUT_PIN,
                pd_sck_pin= HardwareConfig.HX711_SCK_PIN,
            )
            hx.tare()
            logger.info("Load cell tared")
            return True
        except Exception as exc:
            logger.error("Tare failed: %s", exc)
            return False
        finally:
            try:
                GPIO.cleanup()
            except Exception:
                pass