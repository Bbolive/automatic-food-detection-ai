/**
 * static/main.js
 * ────────────────────────────────────────────────────────
 * Frontend Logic ทั้งหมด
 *
 * แบ่งเป็น sections:
 *   1. State         — ตัวแปร global
 *   2. Screen        — navigation ระหว่างหน้าจอ
 *   3. Clock         — นาฬิกาบน topbar
 *   4. Status        — ตรวจสอบสถานะกล้อง
 *   5. Weight        — อ่านน้ำหนัก
 *   6. File Input    — preview ภาพที่เลือก
 *   7. Detection     — ส่งภาพ → รับผล
 *   8. Render Result — แสดงผลใน result screen
 *   9. End Screen    — countdown กลับหน้า home
 *  10. Toast         — แจ้งเตือน
 *  11. Loading       — overlay ขณะรอ
 *
 * แก้ไขที่นี่เมื่อ:
 *   - เปลี่ยน format ตาราง result
 *   - เพิ่ม field ใหม่ใน UI
 *   - เปลี่ยน countdown วินาที
 * ────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════
   1. State
══════════════════════════════════════════════════════ */
const API_BASE       = '';           // '' = same origin, เปลี่ยนถ้าแยก server
const COUNTDOWN_SEC  = 5;            // วินาที countdown ก่อนกลับ home
const WEIGHT_POLL_MS = 5000;         // ความถี่อ่านน้ำหนัก (ms)

let currentFile         = null;      // ไฟล์ภาพที่เลือก
let lastDetectionResult = null;      // ผลจาก /api/detect ใช้ส่ง /api/confirm ตอนกดยืนยัน
let countdownTimer      = null;      // countdown interval
let weightTimer         = null;      // weight polling interval


/* ══════════════════════════════════════════════════════
   2. Screen Navigation
══════════════════════════════════════════════════════ */

/**
 * สลับหน้าจอ — ซ่อนทุกหน้าแล้วแสดงหน้าที่ต้องการ
 * @param {string} screenId - id ของ element เช่น 'home-screen'
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
}

/** กลับหน้า Home และ reset state */
function goHome() {
  clearTimeout(countdownTimer);
  lastDetectionResult = null;
  _resetHomeState();
  showScreen('home-screen');
}

/** ไปหน้า End — บันทึกลง DB เมื่อกดยืนยัน แล้วเริ่ม countdown */
async function goToEnd() {
  if (lastDetectionResult) {
    try {
      const res = await fetch(`${API_BASE}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_filename: lastDetectionResult.image_filename,
          detections:     lastDetectionResult.detections,
          total_price:   lastDetectionResult.total_price,
          weight:        lastDetectionResult.weight,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast('❌ บันทึกไม่สำเร็จ: ' + (data.error || res.status), 'error');
        return;
      }
      lastDetectionResult = null;
    } catch (err) {
      showToast('❌ ไม่สามารถบันทึกได้', 'error');
      console.error('Confirm error:', err);
      return;
    }
  }
  showScreen('end-screen');
  startCountdown(COUNTDOWN_SEC);
}

/** Reset ทุกอย่างใน home screen */
function _resetHomeState() {
  currentFile = null;

  // ซ่อน preview
  const previewImg = _el('preview-img');
  previewImg.src    = '';
  previewImg.hidden = true;

  // แสดง placeholder
  _el('no-image-msg').hidden = false;

  // ซ่อน scan line
  _el('scan-line').hidden = true;

  // clear file inputs
  _el('file-input').value   = '';
  _el('camera-input').value = '';
}


/* ══════════════════════════════════════════════════════
   3. Clock
══════════════════════════════════════════════════════ */
function _updateClock() {
  const now = new Date();
  const str = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  document.querySelectorAll('[id^="clock"]').forEach(el => el.textContent = str);
}

setInterval(_updateClock, 1000);
_updateClock();


/* ══════════════════════════════════════════════════════
   4. Camera / System Status
══════════════════════════════════════════════════════ */
async function checkStatus() {
  try {
    const res  = await _get('/api/status');
    const pill = _el('status-pill');
    const txt  = _el('status-text');

    if (res.data?.camera_active) {
      pill.className  = 'status-pill on';
      txt.textContent = 'กล้องพร้อม';
      // บน Pi ซ่อนปุ่ม upload
      _el('upload-row').style.display = 'none';
    } else {
      pill.className  = 'status-pill off';
      txt.textContent = 'ไม่พบกล้อง';
      _el('upload-row').style.display = 'grid';
    }
  } catch {
    // ถ้า API ไม่พร้อม — ไม่ crash
    const pill = _el('status-pill');
    if (pill) {
      pill.className  = 'status-pill off';
      _el('status-text').textContent = 'ออฟไลน์';
    }
  }
}

checkStatus();


/* ══════════════════════════════════════════════════════
   5. Weight
══════════════════════════════════════════════════════ */

/** อ่านน้ำหนักจาก API และอัปเดต UI */
async function refreshWeight() {
  try {
    const res = await _get('/api/weight');
    const el  = _el('weight-display');
    if (el && typeof res.weight === 'number') {
      el.textContent = res.weight.toFixed(1);
    }
  } catch {
    // ล้มเหลวเงียบๆ — weight เป็น optional
  }
}

/** เริ่ม polling น้ำหนักทุก WEIGHT_POLL_MS */
function startWeightPolling() {
  refreshWeight();
  weightTimer = setInterval(refreshWeight, WEIGHT_POLL_MS);
}

/** หยุด polling */
function stopWeightPolling() {
  clearInterval(weightTimer);
}

startWeightPolling();


/* ══════════════════════════════════════════════════════
   6. File Input / Preview
══════════════════════════════════════════════════════ */

/** handler ร่วมสำหรับทั้ง file-input และ camera-input */
function _handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // ตรวจสอบชนิดไฟล์ฝั่ง client
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
  if (!allowed.includes(ext)) {
    showToast('⚠️ รองรับเฉพาะไฟล์ภาพ (JPG, PNG, WebP)', 'error');
    return;
  }

  currentFile = file;

  // แสดง preview
  const reader = new FileReader();
  reader.onload = ev => {
    const img  = _el('preview-img');
    img.src    = ev.target.result;
    img.hidden = false;

    _el('no-image-msg').hidden = true;
    _el('scan-line').hidden    = false;
    showToast('เลือกภาพเรียบร้อยแล้ว', 'success');
  };
  reader.readAsDataURL(file);
}

_el('file-input').addEventListener('change',   _handleFileSelect);
_el('camera-input').addEventListener('change', _handleFileSelect);


/* ══════════════════════════════════════════════════════
   7. Detection
══════════════════════════════════════════════════════ */

/** ส่งภาพไป detect — เรียกจากปุ่ม "ตรวจจับอาหาร" */
async function startDetection() {
  if (!currentFile) {
    showToast('⚠️ กรุณาเลือกภาพก่อนทำการตรวจจับ', 'error');
    return;
  }

  const btn = _el('detect-btn');
  btn.disabled = true;
  showLoading(true);

  try {
    const formData = new FormData();
    formData.append('image',  currentFile);
    formData.append('weight', _el('weight-display').textContent || '0');

    const res = await fetch(`${API_BASE}/api/detect`, {
      method: 'POST',
      body:   formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Detection failed');

    lastDetectionResult = {
      image_filename: data.image_filename,
      detections:     data.detections,
      total_price:   data.total_price,
      weight:        data.weight != null ? data.weight : 0,
    };
    renderResult(data);
    showScreen('result-screen');

  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
    console.error('Detection error:', err);
  } finally {
    showLoading(false);
    btn.disabled = false;
  }
}


/* ══════════════════════════════════════════════════════
   8. Render Result
══════════════════════════════════════════════════════ */

/**
 * แสดงผลการตรวจจับใน result screen
 * ถ้ามี data.menus (เมนูหลัก + วัตถุดิบ) จะแสดงแบบย่อ/ขยายได้
 * @param {Object} data - response จาก /api/detect
 */
function renderResult(data) {
  // ── Annotated Image ──────────────────────────────
  const resultImg = _el('result-img');
  if (data.annotated_image) {
    resultImg.src = data.annotated_image;
  } else if (currentFile) {
    resultImg.src = URL.createObjectURL(currentFile);
  }

  const tbody = _el('det-tbody');
  const colors = ['#22d9a3', '#3b9eff', '#ff6b4a', '#b06aff', '#ffd23f', '#39d353'];

  if (data.menus && data.menus.length > 0) {
    // ── โหมดเมนูหลัก + วัตถุดิบ (หลายเมนูในภาพเดียว) ─────
    tbody.innerHTML = data.menus.map((menu, idx) => {
      const hasIngredients = menu.ingredients && menu.ingredients.length > 0;
      const wt = (menu.weight != null && Number(menu.weight) > 0)
        ? `${Number(menu.weight).toFixed(1)} กรัม`
        : '0 กรัม';
      const accPct = menu.accuracy_avg != null
        ? Math.round(menu.accuracy_avg * 100)
        : null;
      const ingredientsHtml = hasIngredients
        ? menu.ingredients.map(ing => {
            const pct = Math.round(ing.confidence * 100);
            return `<span class="ingredient-tag"><span class="ingredient-name">${ing.name_th || ing.name}</span> <span class="ingredient-conf">${pct}%</span></span>`;
          }).join('')
        : '<span class="ingredient-none">ไม่มีรายการวัตถุดิบย่อย</span>';

      return `
        <tr class="menu-row" data-menu-index="${idx}">
          <td class="menu-cell">
            <button type="button" class="menu-expand" aria-expanded="false" aria-controls="ingredients-${idx}" id="menu-btn-${idx}" title="แสดง/ซ่อนวัตถุดิบ">
              <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="menu-name-wrap">
              <span class="menu-name">${menu.name_th || menu.name}</span>
              ${menu.name_en ? `<span class="menu-name-en">${menu.name_en}</span>` : ''}
            </div>
          </td>
          <td class="menu-accuracy">${accPct != null ? accPct + '%' : '—'}</td>
          <td class="menu-weight">${wt}</td>
          <td class="price-cell">฿${(menu.price || 0).toFixed(0)}</td>
        </tr>
        <tr class="ingredients-row" id="ingredients-${idx}" role="region" aria-labelledby="menu-btn-${idx}" hidden>
          <td colspan="4" class="ingredients-cell">
            <div class="ingredients-list">${ingredientsHtml}</div>
          </td>
        </tr>`;
    }).join('');

    // ปุ่มขยาย — toggle การแสดงวัตถุดิบ
    tbody.querySelectorAll('.menu-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.closest('.menu-row').dataset.menuIndex;
        const region = document.getElementById(`ingredients-${idx}`);
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', !expanded);
        if (region) region.hidden = expanded;
      });
    });
  } else {
    // ── โหมดเดิม: แสดงทุก detection แบบแบน ────────────────
    tbody.innerHTML = data.detections.map((det, i) => {
      const color = colors[i % colors.length];
      const pct   = Math.round(det.confidence * 100);
      const wt    = det.weight > 0 ? `${det.weight.toFixed(1)}g` : '—';

      return `
        <tr>
          <td>
            <div style="font-weight:600;font-size:.83rem;line-height:1.3;">${det.name_th || det.name}</div>
            <div style="font-size:.68rem;color:var(--muted);">${det.name_en || ''}</div>
          </td>
          <td>
            <div class="conf-wrap">
              <span class="conf-pct" style="color:${color}">${pct}%</span>
              <div class="conf-bar-bg">
                <div class="conf-bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
            </div>
          </td>
          <td style="font-family:var(--font-mono);font-size:.76rem;color:var(--muted)">${wt}</td>
          <td class="price-cell">฿${det.price.toFixed(0)}</td>
        </tr>`;
    }).join('');
  }

  // ── Total ────────────────────────────────────────
  const totalPrice = data.total_price != null ? data.total_price : 0;
  const itemCount  = (data.menus && data.menus.length > 0)
    ? `${data.menus.length} เมนู`
    : `${data.detections.length} รายการ`;
  _el('total-price-display').textContent = totalPrice.toFixed(0);
  _el('total-item-count').textContent    = itemCount;

  // ── Session Info ───────────────────────────────── (บันทึกเมื่อกดยืนยัน)
  _el('session-info').textContent = data.session_id
    ? `SESSION #${data.session_id}  ·  บันทึกแล้ว ${new Date().toLocaleString('th-TH')}`
    : 'กดปุ่ม "ยืนยัน / เสร็จสิ้น" เพื่อบันทึกลงระบบ';
}


/* ══════════════════════════════════════════════════════
   9. End Screen Countdown
══════════════════════════════════════════════════════ */

/**
 * เริ่ม countdown แล้วกลับ home อัตโนมัติ
 * @param {number} seconds - จำนวนวินาที
 */
function startCountdown(seconds) {
  clearTimeout(countdownTimer);

  const circle    = _el('countdown-circle');
  const numEl     = _el('countdown-num');
  const totalDash = 213.6;   // 2π × r(34)
  let remaining   = seconds;

  const tick = () => {
    numEl.textContent = remaining;
    circle.style.strokeDashoffset =
      totalDash * (1 - remaining / seconds);

    if (remaining <= 0) {
      goHome();
      return;
    }
    remaining--;
    countdownTimer = setTimeout(tick, 1000);
  };

  tick();
}


/* ══════════════════════════════════════════════════════
   10. Toast Notification
══════════════════════════════════════════════════════ */

let _toastTimer = null;

/**
 * แสดง toast notification
 * @param {string} msg     - ข้อความ
 * @param {string} [type]  - '' | 'success' | 'error'
 * @param {number} [ms]    - ระยะเวลาแสดง (ms)
 */
function showToast(msg, type = '', ms = 2600) {
  const el = _el('toast');
  clearTimeout(_toastTimer);

  el.textContent = msg;
  el.className   = `show ${type}`;

  _toastTimer = setTimeout(() => {
    el.className = '';
  }, ms);
}


/* ══════════════════════════════════════════════════════
   11. Loading Overlay
══════════════════════════════════════════════════════ */

/**
 * แสดง/ซ่อน loading overlay
 * @param {boolean} show
 * @param {string}  [text] - ข้อความ
 */
function showLoading(show, text = 'กำลังวิเคราะห์อาหาร...') {
  const el = _el('loading-overlay');
  if (show) {
    _el('loader-text').textContent = text;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}


/* ══════════════════════════════════════════════════════
   12. Private Helpers
══════════════════════════════════════════════════════ */

/** shorthand getElementById */
function _el(id) {
  return document.getElementById(id);
}

/**
 * GET request helper — แปลง response เป็น JSON
 * @param {string} path
 * @returns {Promise<Object>}
 */
async function _get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}