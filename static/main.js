/**
 * main.js — Food AI Touchscreen UI (800×480)
 *
 * IDs ที่ใช้ (ตรงกับ index.html):
 *   home-screen, result-screen, end-screen
 *   status-camera-text, status-camera-dot
 *   camera-box, no-image-msg, preview-img, scan-line
 *   upload-row, file-input, camera-input
 *   weight-display, detect-btn
 *   result-img, menu-list
 *   total-price-display, session-info
 *   countdown-circle, countdown-num
 *   loading-overlay, loader-text, toast
 */
"use strict";

/* ── State ────────────────────────────────────────────── */
const API_BASE = "";
const COUNTDOWN_SEC = 5;
const WEIGHT_POLL_MS = 5000;

let currentFile = null;
let lastDetectionResult = null;
let countdownTimer = null;

/* ── Helpers ──────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const setText = (id, v) => {
  const e = $(id);
  if (e) e.textContent = v;
};
const setStyle = (id, p, v) => {
  const e = $(id);
  if (e) e.style[p] = v;
};
const setHidden = (id, h) => {
  const e = $(id);
  if (e) e.hidden = h;
};

/* ── Screen navigation ────────────────────────────────── */
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  $(id)?.classList.add("active");
}

function goHome() {
  clearTimeout(countdownTimer);
  lastDetectionResult = null;
  _resetHome();
  showScreen("home-screen");
}

async function goToEnd() {
  if (!lastDetectionResult) {
    showScreen("end-screen");
    startCountdown(COUNTDOWN_SEC);
    return;
  }

  showLoading(true, "กำลังบันทึกข้อมูล...");
  try {
    const res = await fetch(`${API_BASE}/api/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pending_file: lastDetectionResult.pending_file || "",
        dishes: lastDetectionResult.dishes || [],
        total_price: lastDetectionResult.total_price || 0,
        weight: parseFloat($("weight-display")?.textContent || "0"),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) {
      showToast("⚠️ บันทึกไม่สำเร็จ: " + (d.error || res.status), "error");
      showLoading(false);
      return;
    }
  } catch (err) {
    showToast("⚠️ " + err.message, "error");
    showLoading(false);
    return;
  } finally {
    showLoading(false);
  }

  lastDetectionResult = null;
  showScreen("end-screen");
  startCountdown(COUNTDOWN_SEC);
}

function _resetHome() {
  currentFile = null;
  const pi = $("preview-img");
  if (pi) {
    pi.src = "";
    pi.hidden = true;
  }
  setHidden("no-image-msg", false);
  setHidden("scan-line", true);
  const fi = $("file-input"),
    ci = $("camera-input");
  if (fi) fi.value = "";
  if (ci) ci.value = "";
}

/* ── Clock ────────────────────────────────────────────── */
// (ไม่มี clock element ใน mockup ใหม่ — skip)

/* ── Camera status ────────────────────────────────────── */
async function checkStatus() {
  try {
    const d = await _get("/api/status");
    const isActive = d.data?.camera_active;

    setText("status-camera-text", isActive ? "พร้อมใช้งาน" : "ไม่พบกล้อง");

    const dot = $("status-camera-dot");
    if (dot) dot.className = isActive ? "dot dot-on" : "dot dot-off";

    // ซ่อน upload buttons บน Pi ที่มีกล้องจริง
    setStyle("upload-row", "display", isActive ? "none" : "grid");
  } catch {
    setText("status-camera-text", "ออฟไลน์");
  }
}
checkStatus();

/* ── Weight polling ───────────────────────────────────── */
async function refreshWeight() {
  try {
    const d = await _get("/api/weight");
    if (typeof d.weight === "number")
      setText("weight-display", d.weight.toFixed(1));
  } catch {
    /* mock mode */
  }
}
refreshWeight();
setInterval(refreshWeight, WEIGHT_POLL_MS);

/* ── File select / preview ────────────────────────────── */
function _onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const ok = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
  if (!ok.includes("." + file.name.split(".").pop().toLowerCase())) {
    showToast("รองรับเฉพาะไฟล์ภาพ (JPG PNG WebP)", "error");
    return;
  }
  currentFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = $("preview-img");
    if (img) {
      img.src = ev.target.result;
      img.hidden = false;
    }
    setHidden("no-image-msg", true);
    showToast("เลือกภาพเรียบร้อย", "success");
  };
  reader.readAsDataURL(file);
}
$("file-input")?.addEventListener("change", _onFile);
$("camera-input")?.addEventListener("change", _onFile);
/* ── Pi Camera Capture ───────────────────────── */

async function captureFromPi() {

  showLoading(true, "กำลังถ่ายภาพ...");

  try {
    const res = await fetch("/api/capture", {
      method: "POST"
    });

    const data = await res.json();

    if (!data.success)
      throw new Error(data.error || "Camera error");

    const img = $("preview-img");

    img.src = data.image_url + "?t=" + Date.now();
    img.hidden = false;

    setHidden("no-image-msg", true);

    // ⭐ สำคัญมาก
    currentFile = null;
    window.piCapturedFilename = data.filename;

    showToast("ถ่ายภาพสำเร็จ", "success");

  } catch (err) {
    console.error(err);
    showToast("กล้องไม่พร้อม", "error");
  }

  showLoading(false);
}

/* ── Detection ────────────────────────────────────────── */
async function startDetection() {

  const btn = $("detect-btn");
  if (btn) btn.disabled = true;

  showLoading(true);

  try {

    let res;

    /* ===== CASE 1 : Pi Camera ===== */
    if (window.piCapturedFilename) {

      res = await fetch("/api/detect-captured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: window.piCapturedFilename
        }),
      });

    }
    /* ===== CASE 2 : Upload ===== */
    else if (currentFile) {

      const form = new FormData();
      form.append("image", currentFile);
      form.append("weight", $("weight-display")?.textContent || "0");

      res = await fetch("/api/detect", {
        method: "POST",
        body: form,
      });

    } else {
      showToast("ยังไม่มีภาพ", "error");
      return;
    }

    const data = await res.json();

    if (!res.ok || !data.success)
      throw new Error(data.error || "Detection failed");

    lastDetectionResult = {
      pending_file: data.pending_file || "",
      dishes: data.dishes || [],
      total_price: data.total_price || 0,
    };

    renderResult(data);
    showScreen("result-screen");

  } catch (err) {
    console.error(err);
    showToast("❌ " + err.message, "error");
  }

  showLoading(false);
  if (btn) btn.disabled = false;
}

/* ── Render result ────────────────────────────────────── */

// สีสำหรับ menu cards (ตาม mockup: purple, pink, blue, teal ...)
const CARD_COLORS = [
  { bg: "#6d28d9", border: "#7c3aed" }, // purple
  { bg: "#be185d", border: "#db2777" }, // pink
  { bg: "#1d4ed8", border: "#2563eb" }, // blue
  { bg: "#0f766e", border: "#0d9488" }, // teal
  { bg: "#9a3412", border: "#c2410c" }, // orange-dark
];

function renderResult(data) {
  // ── Annotated image ──────────────────────────────────
  const ri = $("result-img");
  if (ri) {
    ri.src =
      data.annotated_image ||
      (currentFile ? URL.createObjectURL(currentFile) : "");
  }

  // ── Build dishes array ───────────────────────────────
  // รองรับทั้ง data.dishes (จาก detector ใหม่) และ data.menus / data.detections (เก่า)
  let dishes = [];
  if (Array.isArray(data.dishes) && data.dishes.length > 0) {
    dishes = data.dishes;
  } else if (Array.isArray(data.menus) && data.menus.length > 0) {
    dishes = data.menus.map((m) => ({
      name_th: m.name_th || m.name,
      name_en: m.name_en || "",
      price: m.price || 0,
      weight: m.weight || 0,
      ingredients: m.ingredients || [],
    }));
  } else if (Array.isArray(data.detections) && data.detections.length > 0) {
    dishes = data.detections.map((d) => ({
      name_th: d.name_th || d.name,
      name_en: d.name_en || "",
      price: d.price || 0,
      weight: d.weight || 0,
      confidence: d.confidence || 0,
      ingredients: [],
    }));
  }

  // ── Render menu cards ────────────────────────────────
  const list = $("menu-list");
  if (!list) {
    console.error("#menu-list not found");
    return;
  }

  if (dishes.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:20px;color:#64748b;font-size:.8rem">
        ไม่พบรายการอาหาร
      </div>`;
  } else {
    list.innerHTML = dishes.map((dish, i) => _menuCardHTML(dish, i)).join("");
  }

  // ── Total price ──────────────────────────────────────
  const total =
    data.total_price || dishes.reduce((s, d) => s + (d.price || 0), 0);
  setText("total-price-display", Math.round(total));
}

function _menuCardHTML(dish, i) {
  const c = CARD_COLORS[i % CARD_COLORS.length];
  const wt = (dish.weight || 0) > 0 ? `${Math.round(dish.weight)} กรัม` : "—";
  const ings = Array.isArray(dish.ingredients) ? dish.ingredients : [];

  const ingHTML =
    ings.length > 0
      ? ings
          .map((ing) => {
            const pct = Math.round((ing.confidence || 0) * 100);
            return `
          <div class="detail-item">
            <span>- ${ing.name_th || ing.name}</span>
            <span class="detail-conf">${pct}%</span>
          </div>`;
          })
          .join("")
      : "";

  const hasDetail = ings.length > 0;

  return `
    <div class="menu-card" id="mcard-${i}" style="background:${c.bg};border:2px solid ${c.border}">
      <div class="menu-card-main"
           onclick="${hasDetail ? `toggleMenuCard(${i})` : ""}">
        <span class="menu-card-name">${dish.name_th || dish.name || "—"}</span>
        <span class="menu-card-weight">${wt}</span>
        <span class="menu-card-price">฿${Math.round(dish.price || 0)} บาท</span>
        ${hasDetail ? `<span class="menu-card-arrow" id="marrow-${i}">▼</span>` : ""}
      </div>
      ${
        hasDetail
          ? `
        <div class="menu-card-detail" id="mdetail-${i}" style="display:none">
          <span class="detail-title">รายละเอียดเพิ่มเติม</span>
          <div class="detail-items">${ingHTML}</div>
        </div>`
          : ""
      }
    </div>`;
}

function toggleMenuCard(i) {
  const detail = $(`mdetail-${i}`);
  const arrow = $(`marrow-${i}`);
  const card = $(`mcard-${i}`);
  if (!detail) return;
  const open = detail.style.display !== "none";
  detail.style.display = open ? "none" : "block";
  if (arrow) arrow.style.transform = open ? "" : "rotate(180deg)";
  if (card) card.classList.toggle("open", !open);
}

/* ── Countdown ────────────────────────────────────────── */
function startCountdown(sec) {
  clearTimeout(countdownTimer);
  const circle = $("countdown-circle");
  const num = $("countdown-num");
  const total = 188.5; // 2π × 30
  let n = sec;
  (function tick() {
    setText("countdown-num", n);
    if (circle) circle.style.strokeDashoffset = total * (1 - n / sec);
    if (n-- <= 0) {
      goHome();
      return;
    }
    countdownTimer = setTimeout(tick, 1000);
  })();
}

/* ── Toast ────────────────────────────────────────────── */
let _tt = null;
function showToast(msg, type = "", ms = 2600) {
  const el = $("toast");
  if (!el) return;
  clearTimeout(_tt);
  el.textContent = msg;
  el.className = `show ${type}`;
  _tt = setTimeout(() => {
    el.className = "";
  }, ms);
}

/* ── Loading ──────────────────────────────────────────── */
function showLoading(show, text = "กำลังวิเคราะห์อาหาร...") {
  const el = $("loading-overlay");
  if (!el) return;
  setText("loader-text", text);
  el.classList.toggle("show", show);
}

/* ── Fetch helper ─────────────────────────────────────── */
async function _get(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}