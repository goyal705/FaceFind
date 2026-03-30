const API = "/api";
let token = localStorage.getItem("ff_admin_token");
let currentUser = JSON.parse(localStorage.getItem("ff_admin_user") || "null");
let selectedEventId = null;

// ── API helper ──────────────────────────────────────
async function api(method, path, body = null, auth = true) {
  const headers = { "Content-Type": "application/json" };
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

// ── Toast ───────────────────────────────────────────
function toast(msg, type = "ok") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Init ────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  setupOTPInputs();
  if (token && currentUser && currentUser.role === "admin") showDashboard();
  else showAuth();
});

function showAuth() {
  document.getElementById("auth-screen").style.display = "flex";
  document.getElementById("dashboard-screen").style.display = "none";
  document.getElementById("main-nav").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("dashboard-screen").style.display = "block";
  document.getElementById("main-nav").classList.remove("hidden");
  document.getElementById("nav-name").textContent = currentUser.name;
  loadEvents();
}

function logout() {
  localStorage.removeItem("ff_admin_token");
  localStorage.removeItem("ff_admin_user");
  token = null;
  currentUser = null;
  showAuth();
}

// ── OTP inputs ──────────────────────────────────────
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
      const paste = (e.clipboardData.getData("text") || "")
        .replace(/\D/g, "")
        .slice(0, 6);
      [...paste].forEach((ch, j) => {
        if (digits[j]) digits[j].value = ch;
      });
      if (digits[Math.min(paste.length, digits.length - 1)])
        digits[Math.min(paste.length, digits.length - 1)].focus();
    });
  });
}

function getOTP() {
  return [...document.querySelectorAll(".otp-digit")]
    .map((d) => d.value)
    .join("");
}

// ── Auth flow ────────────────────────────────────────
let currentMobile = "";

async function sendOTP() {
  const mobile = document.getElementById("mobile-input").value.trim();
  if (!/^\d{10}$/.test(mobile)) {
    showError("auth-error", "Enter a valid 10-digit mobile number");
    return;
  }
  currentMobile = mobile;

  const btn = document.getElementById("send-otp-btn");
  btn.innerHTML = '<div class="spin"></div> Sending…';
  btn.disabled = true;

  try {
    const res = await api("POST", "/auth/send-otp", { mobile }, false);
    document.getElementById("otp-mobile-display").textContent = mobile;

    // Check if new user
    document.getElementById("name-row").classList.remove("hidden");

    document.getElementById("step-mobile").classList.add("hidden");
    document.getElementById("step-otp").classList.remove("hidden");
    hideError("auth-error");
    toast("OTP sent! (dev: " + (res.dev_otp || "123456") + ")");
    document.querySelector(".otp-digit").focus();
  } catch (e) {
    showError("auth-error", e.message);
  } finally {
    btn.innerHTML = "Send OTP";
    btn.disabled = false;
  }
}

async function verifyOTP() {
  const otp = getOTP();
  const name = document.getElementById("name-input").value.trim();
  if (otp.length < 6) {
    showError("auth-error", "Enter the 6-digit OTP");
    return;
  }

  const btn = document.getElementById("verify-otp-btn");
  btn.innerHTML = '<div class="spin"></div> Verifying…';
  btn.disabled = true;

  try {
    const data = await api(
      "POST",
      "/auth/verify-otp",
      {
        mobile: currentMobile,
        otp,
        name: name || undefined,
        role: "admin",
      },
      false,
    );

    if (data.role !== "admin") {
      showError("auth-error", "This portal is for admins only.");
      return;
    }

    token = data.access_token;
    currentUser = { id: data.user_id, name: data.name, role: data.role };
    localStorage.setItem("ff_admin_token", token);
    localStorage.setItem("ff_admin_user", JSON.stringify(currentUser));
    hideError("auth-error");
    showDashboard();
  } catch (e) {
    showError("auth-error", e.message);
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

// ── Events ───────────────────────────────────────────
let events = [];

async function loadEvents() {
  try {
    events = await api("GET", "/events");
    renderEvents();
    updateStats();
  } catch (e) {
    toast("Failed to load events: " + e.message, "err");
  }
}

function updateStats() {
  document.getElementById("stat-total").textContent = events.length;
  document.getElementById("stat-active").textContent = events.filter(
    (e) => e.status === "active",
  ).length;
  document.getElementById("stat-photos").textContent = events.reduce(
    (s, e) => s + (e.photo_count || 0),
    0,
  );
}

function renderEvents() {
  const grid = document.getElementById("events-grid");
  if (!events.length) {
    grid.innerHTML =
      '<div class="empty-state"><div class="icon">📋</div><p>No events yet. Create your first event.</p></div>';
    return;
  }
  grid.innerHTML = events
    .map(
      (ev) => `
    <div class="event-card">
      <div>
        <div class="event-name">${esc(ev.name)}</div>
        <div class="event-meta">
          <span>${badgeHTML(ev.status)}</span>
          <span>📸 ${ev.photo_count || 0} photos</span>
          <span>📅 ${fmtDate(ev.created_at)}</span>
        </div>
      </div>
      <div class="event-actions">
        <button class="btn-sm btn-sm-accent" onclick="openDetail(${ev.id})">View Details</button>
        ${
          ev.status === "inactive"
            ? `<button class="btn-sm btn-sm-success" onclick="quickStatus(${ev.id},'active')">Activate</button>`
            : ev.status === "active"
              ? `<button class="btn-sm btn-sm-danger" onclick="quickStatus(${ev.id},'inactive')">Deactivate</button>`
              : ""
        }
      </div>
    </div>`,
    )
    .join("");
}

function badgeHTML(status) {
  const map = {
    active: "badge-active",
    inactive: "badge-inactive",
    archived: "badge-archived",
  };
  return `<span class="badge ${map[status] || ""}">${status}</span>`;
}

// ── Create event ─────────────────────────────────────
function openCreateModal() {
  document.getElementById("ev-name").value = "";
  document.getElementById("ev-desc").value = "";
  document.getElementById("ev-uploader").value = "";
  hideError("create-error");
  openModal("create-modal");
}

async function createEventFaceFinder() {
  const name = document.getElementById("ev-name").value.trim();
  if (!name) {
    showError("create-error", "Event name is required");
    return;
  }
  const btn = document.getElementById("create-btn");
  btn.innerHTML = '<div class="spin"></div>';
  btn.disabled = true;

  try {
    const ev = await api("POST", "/events", {
      name,
      description: document.getElementById("ev-desc").value.trim() || null,
      uploader_mobile:
        document.getElementById("ev-uploader").value.trim() || null,
    });
    events.unshift(ev);
    renderEvents();
    updateStats();
    closeModal("create-modal");
    toast("Event created! 🎉");
  } catch (e) {
    showError("create-error", e.message);
  } finally {
    btn.innerHTML = "Create Event";
    btn.disabled = false;
  }
}

// ── Event detail ─────────────────────────────────────
async function openDetail(id) {
  selectedEventId = id;
  const ev = events.find((e) => e.id === id);
  if (!ev) return;

  document.getElementById("detail-event-name").textContent = ev.name;
  const uploadLink = `${window.location.origin}/uploader?token=${ev.upload_token}`;
  document.getElementById("detail-upload-link").textContent = uploadLink;
  document.getElementById("detail-upload-link").dataset.value = uploadLink;
  document.getElementById("detail-status-badge").innerHTML = badgeHTML(
    ev.status,
  );
  document.getElementById("detail-photo-count").textContent =
    `${ev.photo_count || 0} photos`;
  document.getElementById("detail-created").textContent = fmtDate(
    ev.created_at,
  );

  await loadAudienceLink(id)

  // Toggle status buttons
  document.getElementById("btn-activate").style.display =
    ev.status !== "active" ? "" : "none";
  document.getElementById("btn-deactivate").style.display =
    ev.status === "active" ? "" : "none";

  openModal("detail-modal");
}

async function setEventStatus(status) {
  try {
    const ev = await api("PATCH", `/events/${selectedEventId}`, { status });
    const idx = events.findIndex((e) => e.id === selectedEventId);
    if (idx >= 0) events[idx] = ev;
    renderEvents();
    updateStats();
    closeModal("detail-modal");
    toast(`Event ${status}!`);
  } catch (e) {
    toast(e.message, "err");
  }
}

async function quickStatus(id, status) {
  try {
    const ev = await api("PATCH", `/events/${id}`, { status });
    const idx = events.findIndex((e) => e.id === id);
    if (idx >= 0) events[idx] = ev;
    renderEvents();
    updateStats();
    toast(`Event ${status}!`);
  } catch (e) {
    toast(e.message, "err");
  }
}

async function regenUploadToken() {
  try {
    const ev = await api(
      "POST",
      `/events/${selectedEventId}/regen-upload-token`,
    );
    const idx = events.findIndex((e) => e.id === selectedEventId);
    if (idx >= 0) events[idx] = ev;
    const uploadLink = `${window.location.origin}/uploader?token=${ev.upload_token}`;
    document.getElementById("detail-upload-link").textContent = uploadLink;
    document.getElementById("detail-upload-link").dataset.value = uploadLink;
    toast("Upload link regenerated!");
  } catch (e) {
    toast(e.message, "err");
  }
}

// ── Helpers ──────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add("show");
}
function hideError(id) {
  document.getElementById(id).classList.remove("show");
}
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function copyText(elId) {
  const el = document.getElementById(elId);
  const val = el.dataset.value || el.textContent;
  navigator.clipboard
    .writeText(val)
    .then(() => toast("Copied!"))
    .catch(() => toast("Copy failed", "err"));
}

// Close modal on overlay click
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
});

async function loadAudienceLink(eventId) {
  const links = await api("GET", `/links/event/${eventId}`);
  const linkBox = document.getElementById("audience-active-link");
  const copyBtn = document.getElementById("copy-audience-link-btn");

  const activeLink = links.find((l) => l.is_active);

  if (!activeLink) {
    linkBox.textContent = "No active audience link";
    linkBox.dataset.value = "";
    copyBtn.disabled = true;
    return;
  }

  linkBox.textContent = activeLink.audience_url;
  linkBox.dataset.value = activeLink.audience_url;
  copyBtn.disabled = false;
}

async function generateAudienceLink() {
  if (!selectedEventId) return;

  const btn = document.getElementById("generate-audience-link-btn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const link = await api("POST", `/links/generate/${selectedEventId}`);
    document.getElementById("audience-active-link").textContent = link.audience_url;
    document.getElementById("audience-active-link").dataset.value = link.audience_url;
    toast("Audience link generated!");
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(str = "") {
  return escapeHtml(str);
}