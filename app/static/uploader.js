const API = "/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = localStorage.getItem("ff_up_token");
let currentUser = JSON.parse(localStorage.getItem("ff_up_user") || "null");
let currentEvent = null;
let queue = [];
let links = [];
let photoToDelete = null;
let uploadToken = window.UPLOAD_TOKEN || getTokenFromURL() || "";
const serverUploadToken = window.SERVER_UPLOAD_TOKEN || "";


function getTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

// ── Helpers ─────────────────────────────────────────
const toast = (msg, type = "ok") => {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 3200);
};

const api = async (method, path, body = null, auth = true) => {
  const h = { "Content-Type": "application/json" };
  if (auth && token) h["Authorization"] = `Bearer ${token}`;
  const r = await fetch(API + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : null,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || "Error");
  return d;
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// ── Models ───────────────────────────────────────────
async function loadModels() {
  const bar = document.getElementById("model-bar"),
    text = document.getElementById("model-text");
  const SRCS = [
    "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights",
  ];
  let a = 0;
  while (typeof faceapi === "undefined" && a < 80) {
    await sleep(100);
    a++;
  }
  if (typeof faceapi === "undefined") throw new Error("face-api.js not loaded");
  const nets = [
    { name: "Face Detector", key: "tinyFaceDetector" },
    { name: "Landmarks", key: "faceLandmark68TinyNet" },
    { name: "Recognition", key: "faceRecognitionNet" },
  ];
  for (let i = 0; i < nets.length; i++) {
    text.textContent = `Loading ${nets[i].name}…`;
    bar.style.width = `${Math.round((i / nets.length) * 85)}%`;
    let ok = false;
    for (const s of SRCS) {
      try {
        await faceapi.nets[nets[i].key].loadFromUri(s);
        ok = true;
        break;
      } catch (e) {}
    }
    if (!ok) throw new Error(`Failed: ${nets[i].name}`);
  }
  bar.style.width = "100%";
  text.textContent = "Ready!";
  await sleep(400);
  const ov = document.getElementById("model-overlay");
  ov.style.opacity = "0";
  setTimeout(() => ov.remove(), 500);
}

// ── OTP ──────────────────────────────────────────────
function setupOTPInputs() {
  const digits = document.querySelectorAll(".otp-digit");
  digits.forEach((inp, i) => {
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "");
      if (inp.value && i < digits.length - 1) digits[i + 1].focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && i > 0) digits[i - 1].focus();
    });
    inp.addEventListener("paste", (e) => {
      e.preventDefault();
      const p = (e.clipboardData.getData("text") || "")
        .replace(/\D/g, "")
        .slice(0, 6);
      [...p].forEach((ch, j) => {
        if (digits[j]) digits[j].value = ch;
      });
      digits[Math.min(p.length, digits.length - 1)]?.focus();
    });
  });
}
const getOTP = () =>
  [...document.querySelectorAll(".otp-digit")].map((d) => d.value).join("");

// ══ INIT ═════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", async () => {
  setupOTPInputs();
  try {
    await loadModels();
  } catch (e) {
    document.getElementById("model-text").textContent =
      "⚠ Models failed. Open in Chrome/Firefox.";
  }

  if (token && currentUser) {
    showMainNav();
    uploadToken ? await enterDashboardWithToken(uploadToken) : showEventList();
  } else {
    showAuth();
  }
});

// ── Screen switchers ─────────────────────────────────
function showAuth() {
  set("auth-screen", "flex");
  set("event-list-screen", "none");
  set("dashboard-screen", "none");
  document.getElementById("main-nav").classList.add("hidden");
}
function showMainNav() {
  document.getElementById("main-nav").classList.remove("hidden");
  document.getElementById("nav-name").textContent = currentUser?.name || "—";
}
function showEventList() {
  set("auth-screen", "none");
  set("event-list-screen", "block");
  set("dashboard-screen", "none");
  document.getElementById("nav-back-btn").style.display = "none";
  document.getElementById("nav-event-label").textContent = "";
  loadEventList();
}
function showDashboard() {
  set("auth-screen", "none");
  set("event-list-screen", "none");
  set("dashboard-screen", "block");
  // Show back button only when user arrived via event list (no server-injected token)
  document.getElementById("nav-back-btn").style.display =
    uploadToken && !serverUploadToken ? "" : "none";
}
function set(id, display) {
  document.getElementById(id).style.display = display;
}

function goBackToEventList() {
  // Strip token from URL cleanly
  const u = new URL(window.location.href);
  u.searchParams.delete("token");
  window.history.replaceState({}, "", u.toString());
  uploadToken = "";
  currentEvent = null;
  queue = [];
  links = [];
  document.getElementById("queue-wrap").classList.add("hidden");
  document.getElementById("active-link-wrap").classList.add("hidden");
  document.getElementById("past-links").innerHTML = "";
  showEventList();
}

function logout() {
  localStorage.removeItem("ff_up_token");
  localStorage.removeItem("ff_up_user");
  token = null;
  currentUser = null;
  // showAuth();
  window.location.href = "/uploader";
}

// ══ AUTH ═════════════════════════════════════════════
let currentMobile = "";

async function sendOTP() {
  const mobile = document.getElementById("mobile-input").value.trim();
  if (!/^\d{10}$/.test(mobile)) {
    showErr("auth-error", "Enter valid 10-digit number");
    return;
  }
  currentMobile = mobile;
  const btn = document.getElementById("send-otp-btn");
  btn.innerHTML = '<div class="spin"></div>';
  btn.disabled = true;
  try {
    const res = await api("POST", "/auth/send-otp", { mobile }, false);
    document.getElementById("otp-mobile-display").textContent = mobile;
    document.getElementById("name-row").classList.remove("hidden");
    document.getElementById("step-mobile").classList.add("hidden");
    document.getElementById("step-otp").classList.remove("hidden");
    hideErr("auth-error");
    toast("OTP: " + (res.dev_otp || "123456"));
    document.querySelector(".otp-digit").focus();
  } catch (e) {
    showErr("auth-error", e.message);
  } finally {
    btn.innerHTML = "Send OTP";
    btn.disabled = false;
  }
}

async function verifyOTP() {
  const otp = getOTP(),
    name = document.getElementById("name-input").value.trim();
  if (otp.length < 6) {
    showErr("auth-error", "Enter 6-digit OTP");
    return;
  }
  const btn = document.getElementById("verify-otp-btn");
  btn.innerHTML = '<div class="spin"></div>';
  btn.disabled = true;
  try {
    const data = await api(
      "POST",
      "/auth/verify-otp",
      { mobile: currentMobile, otp, name: name || undefined, role: "uploader" },
      false,
    );
    token = data.access_token;
    currentUser = { id: data.user_id, name: data.name, role: data.role };
    localStorage.setItem("ff_up_token", token);
    localStorage.setItem("ff_up_user", JSON.stringify(currentUser));
    hideErr("auth-error");
    showMainNav();
    uploadToken ? await enterDashboardWithToken(uploadToken) : showEventList();
  } catch (e) {
    showErr("auth-error", e.message);
  } finally {
    btn.innerHTML = "Verify & Sign In";
    btn.disabled = false;
  }
}

function backToMobile() {
  document.getElementById("step-otp").classList.add("hidden");
  document.getElementById("step-mobile").classList.remove("hidden");
  document.querySelectorAll(".otp-digit").forEach((d) => (d.value = ""));
}

// ══ EVENT LIST ════════════════════════════════════════
async function loadEventList() {
  const c = document.getElementById("event-list-container");
  c.innerHTML =
    '<div class="gallery-loading"><div class="spin" style="border-top-color:var(--accent)"></div> Loading events…</div>';
  try {
    const events = await api("GET", "/events/my");
    if (!events.length) {
      c.innerHTML = `<div class="empty-state"><span class="icon">📭</span><h3>No events assigned</h3><p>Ask your admin to assign you to an active event.</p></div>`;
      return;
    }
    c.innerHTML = `<div class="events-list">${events
      .map(
        (ev) => `
      <div class="event-list-card">
        <div class="event-list-info">
          <h3>${esc(ev.name)}</h3>
          ${ev.description ? `<p>${esc(ev.description)}</p>` : ""}
          <div class="event-list-meta">
            <span>📸 ${ev.photo_count || 0} photos</span>
            <span>📅 ${fmtDate(ev.created_at)}</span>
          </div>
        </div>
        <button class="btn-sm btn-sm-accent" onclick="openEvent(${ev.id}, this)">Open →</button>
      </div>`,
      )
      .join("")}
    </div>`;
  } catch (e) {
    c.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><h3>Failed to load</h3><p>${esc(e.message)}</p></div>`;
  }
}

async function openEvent(eventId, btn) {
  if (btn) {
    btn.innerHTML =
      '<div class="spin" style="border-top-color:var(--accent)"></div>';
    btn.disabled = true;
  }
  try {
    const data = await api("POST", `/events/${eventId}/generate-upload-token`);
    uploadToken = data.token;
    // Update URL so refreshing keeps the context
    const u = new URL(window.location.href);
    u.searchParams.set("token", uploadToken);
    window.history.replaceState({}, "", u.toString());
    await enterDashboardWithToken(uploadToken);
  } catch (e) {
    toast(e.message, "err");
    if (btn) {
      btn.innerHTML = "Open →";
      btn.disabled = false;
    }
  }
}

// ══ DASHBOARD ENTRY ═══════════════════════════════════
async function enterDashboardWithToken(tok) {
  uploadToken = tok;
  console.log(tok);
  showDashboard();
  await loadEvent();
  await Promise.all([loadGallery(), loadLinks()]);
}

async function loadEvent() {
  try {
    currentEvent = await api("GET", `/events/by-token/${uploadToken}`);
    document.getElementById("event-name-display").textContent =
      currentEvent.name;
    document.getElementById("event-desc-display").textContent =
      currentEvent.description || "";
    document.getElementById("nav-event-label").textContent = currentEvent.name;
    // Show back button when we came from event list
    if (!"{{ upload_token }}") {
      document.getElementById("nav-back-btn").style.display = "";
    }
  } catch (e) {
    document.getElementById("event-name-display").textContent =
      "Event not found or inactive";
    toast("Invalid event token", "err");
  }
}

// ══ GALLERY ═══════════════════════════════════════════
async function loadGallery() {
  if (!currentEvent) return;
  const c = document.getElementById("gallery-container");
  c.innerHTML =
    '<div class="gallery-loading"><div class="spin" style="border-top-color:var(--accent)"></div> Loading photos…</div>';
  try {
    const photos = await api("GET", `/photos/event/${currentEvent.id}`);
    renderGallery(photos);
  } catch (e) {
    c.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><h3>Could not load photos</h3><p>${esc(e.message)}</p></div>`;
  }
}

function renderGallery(photos) {
  const c = document.getElementById("gallery-container");
  const countEl = document.getElementById("gallery-count");
  countEl.textContent = photos.length ? `(${photos.length})` : "";
  if (!photos.length) {
    c.innerHTML = `<div class="empty-state"><span class="icon">🖼️</span><h3>No photos yet</h3><p>Upload photos using the drop zone above.</p></div>`;
    return;
  }
  c.innerHTML = `<div class="gallery-grid">${photos
    .map((p) => {
      const url = p.url?.startsWith("http")
        ? p.url
        : window.location.origin + p.url;
      return `
      <div class="gallery-item" id="gc-${p.id}">
        <img src="${url}" alt="${esc(p.filename)}" loading="lazy">
        <div class="gallery-overlay">
          <span class="gallery-faces">👤 ${p.faces_indexed || 0} face${p.faces_indexed !== 1 ? "s" : ""}</span>
          <button class="del-btn" onclick="askDelete(${p.id},event)" title="Delete">✕</button>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

// ── Delete ────────────────────────────────────────────
function askDelete(id, e) {
  e?.stopPropagation();
  photoToDelete = id;
  document.getElementById("delete-modal").classList.add("open");
}
function closeDeleteModal() {
  document.getElementById("delete-modal").classList.remove("open");
  photoToDelete = null;
}
async function confirmDelete() {
  if (!photoToDelete) return;
  const btn = document.getElementById("confirm-del-btn");
  btn.innerHTML = '<div class="spin"></div>';
  btn.disabled = true;
  try {
    await api("DELETE", `/photos/${photoToDelete}`);
    const card = document.getElementById(`gc-${photoToDelete}`);
    if (card) {
      card.style.transition = "opacity .22s,transform .22s";
      card.style.opacity = "0";
      card.style.transform = "scale(.88)";
      setTimeout(() => card.remove(), 230);
    }
    const ct = document.getElementById("gallery-count");
    const n = Math.max(
      0,
      (parseInt(ct.textContent.replace(/\D/g, "")) || 0) - 1,
    );
    ct.textContent = n ? `(${n})` : "";
    toast("Photo deleted");
    closeDeleteModal();
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.innerHTML = "Delete";
    btn.disabled = false;
  }
}
document.getElementById("delete-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeDeleteModal();
});

// ══ AUDIENCE LINKS ════════════════════════════════════
async function loadLinks() {
  if (!currentEvent) return;
  try {
    links = await api("GET", `/links/event/${currentEvent.id}`);
    const active = links.find((l) => l.is_active);
    if (active) {
      document.getElementById("active-link-text").textContent =
        active.audience_url;
      document.getElementById("active-link-wrap").classList.remove("hidden");
    }
    renderLinks();
  } catch (e) {}
}

async function generateLink() {
  if (!currentEvent) {
    toast("Event not loaded", "err");
    return;
  }
  const btn = document.getElementById("gen-link-btn");
  btn.innerHTML = '<div class="spin"></div>';
  btn.disabled = true;
  try {
    const link = await api("POST", `/links/generate/${currentEvent.id}`);
    links.unshift(link);
    document.getElementById("active-link-text").textContent = link.audience_url;
    document.getElementById("active-link-wrap").classList.remove("hidden");
    renderLinks();
    toast("New link generated! Old one expired.");
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.innerHTML = "Generate New Link";
    btn.disabled = false;
  }
}

function renderLinks() {
  const el = document.getElementById("past-links");
  const expired = links.filter((l) => !l.is_active);
  if (!expired.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    '<div style="font-size:.72rem;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Previous Links (Expired)</div>' +
    expired
      .map(
        (l) => `
      <div class="past-link-item">
        <span style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${l.audience_url || l.token}</span>
        <span class="expired-tag">EXPIRED</span>
        <span>${fmtDate(l.created_at)}</span>
      </div>`,
      )
      .join("");
}

function copyLink() {
  const txt = document.getElementById("active-link-text").textContent;
  navigator.clipboard
    .writeText(txt)
    .then(() => toast("Link copied!"))
    .catch(() => toast("Copy failed", "err"));
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add("show");
}
function hideErr(id) {
  document.getElementById(id).classList.remove("show");
}
