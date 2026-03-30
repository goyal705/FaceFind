const API = "/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let audienceToken = null;
let eventData = null; // { event_id, event_name, photos: [{id, url, filename, face_descriptors}] }
let userDescriptor = null;
let stream = null;
let lightboxUrl = "",
  lightboxName = "";

const toast = (msg, type = "ok") => {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 3000);
};

// ── Model loading ─────────────────────────────────────
async function loadModels() {
  const bar = document.getElementById("model-bar");
  const text = document.getElementById("model-text");
  const SOURCES = [
    "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights",
  ];

  let attempts = 0;
  while (typeof faceapi === "undefined" && attempts < 80) {
    await sleep(100);
    attempts++;
  }
  if (typeof faceapi === "undefined") throw new Error("face-api not loaded");

  const nets = [
    { name: "Face Detector", key: "tinyFaceDetector" },
    { name: "Landmarks", key: "faceLandmark68TinyNet" },
    { name: "Recognition", key: "faceRecognitionNet" },
  ];
  for (let i = 0; i < nets.length; i++) {
    text.textContent = `Loading ${nets[i].name}…`;
    bar.style.width = `${Math.round((i / nets.length) * 85)}%`;
    let ok = false;
    for (const src of SOURCES) {
      try {
        await faceapi.nets[nets[i].key].loadFromUri(src);
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

// ── Init ─────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  audienceToken = params.get("token") || location.pathname.split("/").pop();

  try {
    await loadModels();
  } catch (e) {
    document.getElementById("model-text").textContent =
      "⚠ Models failed. Open directly in browser.";
  }

  if (!audienceToken) {
    showInvalid();
    return;
  }

  try {
    eventData = await fetch(
      `${API}/links/audience/${audienceToken}/photos`,
    ).then((r) => {
      if (!r.ok) throw new Error("invalid");
      return r.json();
    });
    document.getElementById("event-title").textContent = eventData.event_name;
    document.getElementById("photo-count-display").textContent =
      eventData.photos.length;
    document.getElementById("main-app").style.display = "block";
  } catch (e) {
    showInvalid();
  }
});

function showInvalid() {
  document.getElementById("invalid-screen").style.display = "flex";
  document.getElementById("main-app").style.display = "none";
  const ov = document.getElementById("model-overlay");
  if (ov) {
    ov.style.opacity = "0";
    setTimeout(() => ov.remove(), 500);
  }
}

// ── Steps ─────────────────────────────────────────────
function setStep(n) {
  [1, 2, 3].forEach((i) => {
    const d = document.getElementById(`dot${i}`);
    d.className = "step" + (i < n ? " done" : i === n ? " active" : "");
  });
  ["scan", "searching", "results"].forEach((p, i) => {
    document.getElementById(`panel-${p}`).className =
      "panel" + (i + 1 === n ? " active" : "");
  });
}

// ── Camera ────────────────────────────────────────────
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
    });
    const video = document.getElementById("video");
    video.srcObject = stream;
    await video.play();
    document.getElementById("cam-ring").classList.add("on");
    document.getElementById("scan-line").classList.add("on");
    document.getElementById("cam-status").textContent =
      "Camera ready — look straight ahead";
    document.getElementById("cam-status").className = "camera-status ok";
    document.getElementById("btn-snap").disabled = false;
    document.getElementById("btn-start-cam").style.display = "none";
  } catch (e) {
    document.getElementById("cam-status").textContent =
      "Camera denied. Please allow camera access.";
    document.getElementById("cam-status").className = "camera-status err";
    toast("Camera access denied", "err");
  }
}

async function captureAndSearch() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const btn = document.getElementById("btn-snap");
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div>';

  const status = document.getElementById("cam-status");
  status.textContent = "Detecting your face…";
  status.className = "camera-status";

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5,
  });

  try {
    const det = await faceapi
      .detectSingleFace(canvas, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!det) {
      status.textContent = "No face detected. Try better lighting or angle.";
      status.className = "camera-status err";
      btn.disabled = false;
      btn.innerHTML = "🔍 Find My Photos";
      toast("No face found", "err");
      return;
    }
    userDescriptor = det.descriptor;

    // Show snap
    const snap = document.getElementById("snap-preview");
    snap.src = canvas.toDataURL("image/jpeg", 0.85);
    snap.style.display = "block";
    status.textContent = "Face captured! Searching photos…";
    status.className = "camera-status ok";

    // Stop cam
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.style.display = "none";

    await sleep(300);
    setStep(2);
    await sleep(200);
    runSearch();
  } catch (e) {
    status.textContent = "Processing error, please try again.";
    status.className = "camera-status err";
    btn.disabled = false;
    btn.innerHTML = "🔍 Find My Photos";
  }
}

// ── Face matching ─────────────────────────────────────
async function runSearch() {
  const prog = document.getElementById("search-progress-text");
  const total = eventData.photos.length;
  const THRESHOLD = 0.52;
  const matches = [];

  for (let i = 0; i < total; i++) {
    const photo = eventData.photos[i];
    prog.textContent = `Checking photo ${i + 1} of ${total}…`;

    if (!photo.face_descriptors || !photo.face_descriptors.length) continue;

    let bestDist = Infinity;
    for (const raw of photo.face_descriptors) {
      const desc = new Float32Array(raw);
      const dist = faceapi.euclideanDistance(userDescriptor, desc);
      if (dist < bestDist) bestDist = dist;
    }
    if (bestDist < THRESHOLD) {
      const confidence = Math.round((1 - bestDist / 0.65) * 100);
      matches.push({ photo, distance: bestDist, confidence });
    }
    if (i % 10 === 0) await sleep(0); // yield to UI
  }

  matches.sort((a, b) => a.distance - b.distance);
  showResults(matches);
}

function showResults(matches) {
  setStep(3);
  document.getElementById("result-count").textContent = matches.length;
  const grid = document.getElementById("results-grid");
  grid.innerHTML = "";

  if (!matches.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="icon">😕</div><h3>No matches found</h3>
      <p>You might not appear in these photos, or try scanning again with better lighting.</p>
    </div>`;
    return;
  }

  matches.forEach(({ photo, confidence }) => {
    const fullUrl = photo.url.startsWith("http")
      ? photo.url
      : `${API.replace("/api", "")}${photo.url}`;
    const card = document.createElement("div");
    card.className = "result-card";
    card.onclick = () => openLightbox(fullUrl, photo.filename);
    card.innerHTML = `
      <img src="${fullUrl}" alt="${photo.filename}" loading="lazy">
      <div class="result-card-footer">
        <span class="conf-badge">${confidence}% match</span>
        <button class="dl-btn" title="Download" onclick="event.stopPropagation();downloadPhoto('${fullUrl}','${photo.filename}')">⬇️</button>
      </div>`;
    grid.appendChild(card);
  });

  toast(
    `Found you in ${matches.length} photo${matches.length !== 1 ? "s" : ""}! 🎉`,
  );
}

// ── Lightbox ──────────────────────────────────────────
function openLightbox(url, name) {
  lightboxUrl = url;
  lightboxName = name;
  document.getElementById("lightbox-img").src = url;
  document.getElementById("lightbox").classList.add("open");
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
}
function downloadLightbox() {
  downloadPhoto(lightboxUrl, lightboxName);
}
function downloadPhoto(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "photo.jpg";
  a.target = "_blank";
  a.click();
}

document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeLightbox();
});

// ── Reset ─────────────────────────────────────────────
function resetScan() {
  userDescriptor = null;
  const video = document.getElementById("video");
  video.style.display = "block";
  document.getElementById("snap-preview").style.display = "none";
  document.getElementById("cam-ring").classList.remove("on");
  document.getElementById("scan-line").classList.remove("on");
  document.getElementById("cam-status").textContent =
    'Press "Start Camera" to begin';
  document.getElementById("cam-status").className = "camera-status";
  document.getElementById("btn-snap").disabled = true;
  document.getElementById("btn-snap").innerHTML = "🔍 Find My Photos";
  document.getElementById("btn-start-cam").style.display = "";
  setStep(1);
}
