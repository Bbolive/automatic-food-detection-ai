/**
 * main.js — Food AI Touchscreen UI (800×480)
 */
"use strict";

/* ── State ─────────────────────────────────────────────── */
const API_BASE = "";
const COUNTDOWN_SEC = 5;
const WEIGHT_POLL_MS = 5000;

let currentFile = null;
let lastDetectionResult = null;
let countdownTimer = null;

// ใช้ var เพื่อให้เข้าถึงได้จากทุก scope
var piCapturedFilename = null;

/* ── Helpers ───────────────────────────────────────────── */
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

/* ── Screen navigation ─────────────────────────────────── */
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  $(id)?.classList.add("active");
}

function goHome() {
  clearTimeout(countdownTimer);
  lastDetectionResult = null;
  piCapturedFilename = null;
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
  const img = $("preview-img");
  if (img) {
    img.src = "/video_feed"; // คืน live stream
    img.hidden = false;
  }
  setHidden("no-image-msg", true);
  setHidden("scan-line", true);
  const fi = $("file-input");
  if (fi) fi.value = "";
}

/* ── Camera status ─────────────────────────────────────── */
async function checkStatus() {
  try {
    const d = await _get("/api/status");
    const isActive = d.data?.camera_active;
    setText("status-camera-text", isActive ? "พร้อมใช้งาน" : "ไม่พบกล้อง");
    const dot = $("status-camera-dot");
    if (dot) dot.className = isActive ? "dot dot-on" : "dot dot-off";
    setStyle("upload-row", "display", isActive ? "none" : "grid");
  } catch {
    setText("status-camera-text", "ออฟไลน์");
  }
}
checkStatus();

/* ── Weight polling ────────────────────────────────────── */
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

/* ── File select / preview ─────────────────────────────── */
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

/* ── Pi Camera Capture ─────────────────────────────────── */
async function captureFromPi() {
  console.log("📸 เริ่มสั่งถ่ายภาพ...");
  showLoading(true, "กำลังบันทึกภาพจากกล้อง...");
  try {
    const res = await fetch("/api/capture", { method: "POST" });
    const data = await res.json();

    if (data.success) {
      // ← if/else จากโค้ดใหม่
      const img = $("preview-img");
      img.src = data.image_url + "?t=" + new Date().getTime();
      img.hidden = false;
      setHidden("no-image-msg", true);

      currentFile = null;
      piCapturedFilename = data.filename;

      console.log("✅ ถ่ายสำเร็จ ไฟล์ชื่อ:", piCapturedFilename);
      showToast("📸 ถ่ายภาพสำเร็จ! ตรวจสอบภาพแล้วกดเริ่มตรวจจับ", "success");
    } else {
      showToast("❌ ถ่ายภาพล้มเหลว: " + (data.error || "Unknown"), "error");
    }
  } catch (err) {
    console.error("Capture Error:", err);
    showToast("❌ เชื่อมต่อกล้องไม่ได้", "error");
  }
  showLoading(false);
}

/* ── Detection ─────────────────────────────────────────── */
async function startDetection() {
  console.log("🚀 กำลังส่งภาพไปวิเคราะห์ AI...");

  const btn = $("detect-btn");
  if (btn) btn.disabled = true;

  showLoading(true);
  try {
    let res;

    /* ===== CASE 1 : Pi Camera ===== */
    if (piCapturedFilename) {
      res = await fetch("/api/detect-captured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: piCapturedFilename }),
      });

      /* ===== CASE 2 : File Upload ===== */
    } else if (currentFile) {
      const form = new FormData();
      form.append("image", currentFile);
      form.append("weight", $("weight-display")?.textContent || "0");
      res = await fetch("/api/detect", { method: "POST", body: form });

      /* ===== CASE 3 : ยังไม่มีภาพ ===== */
    } else {
      showToast("⚠️ ต้องถ่ายภาพก่อนเริ่มตรวจจับครับ", "error");
      showLoading(false);
      if (btn) btn.disabled = false;
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
    console.error("Detection Error:", err);
    showToast("❌ " + err.message, "error");
  }

  showLoading(false);
  if (btn) btn.disabled = false;
}

/* ── Render result ─────────────────────────────────────── */
const CARD_COLORS = [
  { bg: "#6d28d9", border: "#7c3aed" },
  { bg: "#be185d", border: "#db2777" },
  { bg: "#1d4ed8", border: "#2563eb" },
  { bg: "#0f766e", border: "#0d9488" },
  { bg: "#9a3412", border: "#c2410c" },
];

function renderResult(data) {
  const ri = $("result-img");
  if (ri) {
    ri.src =
      data.annotated_image ||
      (currentFile ? URL.createObjectURL(currentFile) : "");
  }

  let dishes = [];
  if (Array.isArray(data.dishes) && data.dishes.length) dishes = data.dishes;
  else if (Array.isArray(data.menus) && data.menus.length)
    dishes = data.menus.map((m) => ({
      name_th: m.name_th || m.name,
      name_en: m.name_en || "",
      price: m.price || 0,
      weight: m.weight || 0,
      ingredients: m.ingredients || [],
    }));
  else if (Array.isArray(data.detections) && data.detections.length)
    dishes = data.detections.map((d) => ({
      name_th: d.name_th || d.name,
      name_en: d.name_en || "",
      price: d.price || 0,
      weight: d.weight || 0,
      confidence: d.confidence || 0,
      ingredients: [],
    }));

  const list = $("menu-list");
  if (!list) {
    console.error("#menu-list not found");
    return;
  }

  list.innerHTML =
    dishes.length === 0
      ? `<div style="text-align:center;padding:20px;color:#64748b;font-size:.8rem">ไม่พบรายการอาหาร</div>`
      : dishes.map((dish, i) => _menuCardHTML(dish, i)).join("");

  const total =
    data.total_price || dishes.reduce((s, d) => s + (d.price || 0), 0);
  setText("total-price-display", Math.round(total));
}

function _menuCardHTML(dish, i) {
  const c = CARD_COLORS[i % CARD_COLORS.length];
  const wt = (dish.weight || 0) > 0 ? `${Math.round(dish.weight)} กรัม` : "—";
  const ings = Array.isArray(dish.ingredients) ? dish.ingredients : [];

  const ingHTML = ings
    .map((ing) => {
      const pct = Math.round((ing.confidence || 0) * 100);
      return `
      <div class="detail-item">
        <span>- ${ing.name_th || ing.name}</span>
        <span class="detail-conf">${pct}%</span>
      </div>`;
    })
    .join("");

  const hasDetail = ings.length > 0;
  return `
    <div class="menu-card" id="mcard-${i}" style="background:${c.bg};border:2px solid ${c.border}">
      <div class="menu-card-main" onclick="${hasDetail ? `toggleMenuCard(${i})` : ""}">
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

/* ── Countdown ─────────────────────────────────────────── */
function startCountdown(sec) {
  clearTimeout(countdownTimer);
  const circle = $("countdown-circle"); // null ได้ถ้า HTML ใช้ h1 แทน SVG
  const total = 188.5;
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

/* ── Toast ─────────────────────────────────────────────── */
let _tt = null;
function showToast(msg, type = "", ms = 3000) {
  const el = $("toast");
  if (!el) return;
  clearTimeout(_tt);
  el.textContent = msg;
  el.className = `show ${type}`;
  _tt = setTimeout(() => {
    el.className = "";
  }, ms);
}

/* ── Loading ───────────────────────────────────────────── */
function showLoading(show, text = "กำลังวิเคราะห์อาหาร...") {
  const el = $("loading-overlay");
  if (!el) return;
  setText("loader-text", text);
  el.classList.toggle("show", show);
}

/* ── Fetch helper ──────────────────────────────────────── */
async function _get(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

/* ── Init ──────────────────────────────────────────────── */
window.onload = () => {
  console.log("✅ ระบบหน้าจอพร้อมใช้งาน");
  const uploadRow = $("upload-row");
  if (uploadRow) uploadRow.style.setProperty("display", "flex", "important");
  const detectBtn = $("detect-btn");
  if (detectBtn) {
    detectBtn.style.display = "block";
    detectBtn.disabled = false;
  }
};
