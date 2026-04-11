const API = "/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let audienceToken = null;
let eventData = null; // { event_id, event_name, photos: [...] }
let userDescriptor = null;
let stream = null;
let lightboxUrl = "",
  lightboxName = "";
let foundMatches = [];
let totalProcessed = 0;
let isSearching = false;
let capturedBlob = null;
const MATCH_THRESHOLD = 0.52;
const BATCH_SIZE = 10;
const PARALLEL_WORKERS = 3;
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

  if (typeof faceapi === "undefined") {
    throw new Error("face-api not loaded");
  }

  const nets = [
    { name: "Face Detector", key: "tinyFaceDetector" },
    { name: "Landmarks", key: "faceLandmark68Net" },
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

    if (!ok) {
      throw new Error(`Failed: ${nets[i].name}`);
    }
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

// ─────────────────────────────────────────────
// CAMERA START
// ─────────────────────────────────────────────
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

    // show upload also (optional hybrid UX)
    document.getElementById("upload-fallback").style.display = "block";
  } catch (e) {
    console.error(e);

    document.getElementById("cam-status").textContent =
      "Camera not available. Upload a photo instead.";
    document.getElementById("cam-status").className = "camera-status err";

    // 🔥 SHOW UPLOAD FALLBACK
    document.getElementById("upload-fallback").style.display = "block";

    toast("Camera not working. Use upload.", "err");
  }
}

// ─────────────────────────────────────────────
// IMAGE UPLOAD HANDLER
// ─────────────────────────────────────────────
async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById("snap-preview");

  // show preview
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";

  document.getElementById("cam-status").textContent =
    "Photo selected. Click 'Find My Photos'";
  document.getElementById("cam-status").className = "camera-status ok";

  document.getElementById("btn-snap").disabled = false;

  // store globally
  window.uploadedImageFile = file;
}

// ─────────────────────────────────────────────
// CAPTURE OR UPLOAD → DETECT → SEARCH
// ─────────────────────────────────────────────
async function captureAndSearch() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const btn = document.getElementById("btn-snap");
  const status = document.getElementById("cam-status");

  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div>';

  status.textContent = "Detecting your face…";
  status.className = "camera-status";

  let imageSource;

  // 🔥 CASE 1: UPLOAD
  if (window.uploadedImageFile) {
    imageSource = await createImageBitmap(window.uploadedImageFile);

    canvas.width = imageSource.width;
    canvas.height = imageSource.height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(imageSource, 0, 0);

    capturedBlob = window.uploadedImageFile;
  } else {
    // 🔥 CASE 2: CAMERA
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    capturedBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
  }

  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5,
  });

  try {
    const detections = await faceapi
      .detectAllFaces(canvas, opts)
      .withFaceLandmarks()
      .withFaceDescriptors();

    console.log("Detections", detections);
    

    if (!detections || detections.length === 0) {
      status.textContent = "No face detected. Try better lighting.";
      status.className = "camera-status err";

      btn.disabled = false;
      btn.innerHTML = "🔍 Find My Photos";

      toast("No face found", "err");
      return;
    }

    // 🔥 MULTIPLE FACE CHECK
    if (detections.length > 1) {
      status.textContent =
        "Multiple faces detected. Use a photo with only your face.";
      status.className = "camera-status err";

      btn.disabled = false;
      btn.innerHTML = "🔍 Find My Photos";

      toast("Only one face allowed", "err");
      return;
    }

    userDescriptor = detections[0].descriptor;

    const snap = document.getElementById("snap-preview");
    snap.src = canvas.toDataURL("image/jpeg", 0.85);
    snap.style.display = "block";

    status.textContent = "Face captured! Searching photos…";
    status.className = "camera-status ok";

    // stop camera if running
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    video.style.display = "none";

    await sleep(300);
    setStep(2);
    await sleep(200);

    await runSearch();
  } catch (e) {
    console.log(e);

    status.textContent = "Processing error, please try again.";
    status.className = "camera-status err";

    btn.disabled = false;
    btn.innerHTML = "🔍 Find My Photos";
  }
}

// ─────────────────────────────────────────────
// MATCH API
// ─────────────────────────────────────────────
async function matchBatch(offset, limit) {
  const formData = new FormData();

  formData.append("file", capturedBlob, "capture.jpg");
  formData.append("offset", String(offset));
  formData.append("limit", String(limit));
  formData.append("threshold", String(MATCH_THRESHOLD));

  const res = await fetch(
    `${API}/links/audience/${audienceToken}/match-photos`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!res.ok) {
    throw new Error("Match API failed");
  }

  return await res.json();
}

function updateSearchProgress(processed, total, phase = "Searching") {
  const prog = document.getElementById("search-progress-text");
  const safeProcessed = Math.min(processed, total);
  prog.textContent = `${phase}… checked ${safeProcessed} of ${total} photos`;
}

function normalizePhotoUrl(url) {
  if (!url) return "";
  return url.startsWith("http") ? url : API.replace("/api", "") + url;
}

function mergeMatches(newMatches) {
  if (!newMatches || !newMatches.length) return;

  const existingIds = new Set(foundMatches.map((m) => m.id));
  for (const item of newMatches) {
    if (!existingIds.has(item.id)) {
      foundMatches.push(item);
    }
  }

  foundMatches.sort((a, b) => a.distance - b.distance);
}

async function runSearch() {
  if (isSearching) return;
  isSearching = true;

  const total = eventData?.photos?.length || 0;
  foundMatches = [];
  totalProcessed = 0;

  const resultsGrid = document.getElementById("results-grid");
  resultsGrid.innerHTML = "";

  try {
    updateSearchProgress(0, total, "Starting");

    // First batch: immediate result
    const firstBatch = await matchBatch(0, BATCH_SIZE);
    totalProcessed += firstBatch.processed || 0;
    mergeMatches(firstBatch.matches || []);
    updateSearchProgress(totalProcessed, total, "Searching");

    if (foundMatches.length) {
      showResults(foundMatches, {
        incremental: true,
        done: !firstBatch.has_more,
      });
    }

    if (!firstBatch.has_more) {
      showResults(foundMatches, { done: true });
      isSearching = false;
      return;
    }

    // Remaining batches in parallel
    const offsets = [];
    for (let offset = BATCH_SIZE; offset < total; offset += BATCH_SIZE) {
      offsets.push(offset);
    }

    let cursor = 0;

    async function worker() {
      while (cursor < offsets.length) {
        const currentOffset = offsets[cursor++];
        const data = await matchBatch(currentOffset, BATCH_SIZE);

        totalProcessed += data.processed || 0;
        mergeMatches(data.matches || []);
        updateSearchProgress(totalProcessed, total, "Searching");

        if ((data.matches || []).length) {
          showResults(foundMatches, {
            incremental: true,
            done: false,
          });
        }

        await sleep(0);
      }
    }

    const workers = Array.from(
      { length: Math.min(PARALLEL_WORKERS, offsets.length) },
      () => worker(),
    );

    await Promise.all(workers);

    updateSearchProgress(total, total, "Completed");
    showResults(foundMatches, { done: true });
  } catch (e) {
    document.getElementById("search-progress-text").textContent =
      "Search failed. Please try again.";
    toast("Search failed", "err");
    showResults(foundMatches, { done: true });
  } finally {
    isSearching = false;
  }
}

// ── Results ───────────────────────────────────────────
function showResults(matches, options = {}) {
  const { incremental = false, done = true } = options;

  setStep(3);

  document.getElementById("result-count").textContent = matches.length;

  const grid = document.getElementById("results-grid");
  grid.innerHTML = "";

  if (!matches.length) {
    if (!done) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="icon">⚙️</div>
          <h3>Searching photos…</h3>
          <p>No matches found yet. We are still checking more event photos.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="icon">📷</div>
        <h3>No matches found</h3>
        <p>You might not appear in these photos, or try scanning again with better lighting.</p>
      </div>
    `;
    return;
  }

  matches.forEach((photo) => {
    const fullUrl = normalizePhotoUrl(photo.url);

    const card = document.createElement("div");
    card.className = "result-card";
    card.onclick = () => openLightbox(fullUrl, photo.filename);

    card.innerHTML = `
      <img src="${fullUrl}" alt="${photo.filename || "photo"}" loading="lazy" />
      <div class="result-card-footer">
        <span class="conf-badge">${photo.confidence}% match</span>
        <button
          class="dl-btn"
          title="Download"
          onclick="event.stopPropagation(); downloadPhoto('${fullUrl}', '${(photo.filename || "photo.jpg").replace(/'/g, "\\'")}')"
        >⬇</button>
      </div>
    `;

    grid.appendChild(card);
  });

  if (incremental && matches.length) {
    toast(
      `Found ${matches.length} photo${matches.length > 1 ? "s" : ""} so far`,
    );
  } else if (done) {
    toast(
      `Found you in ${matches.length} photo${matches.length > 1 ? "s" : ""}!`,
    );
  }
}

// ── Lightbox ──────────────────────────────────────────
function openLightbox(url, name) {
  lightboxUrl = url;
  lightboxName = name || "photo.jpg";
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
  foundMatches = [];
  totalProcessed = 0;
  isSearching = false;
  capturedBlob = null;

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

  document.getElementById("search-progress-text").textContent =
    "Comparing your face against event photos…";
  document.getElementById("result-count").textContent = "0";
  document.getElementById("results-grid").innerHTML = "";

  setStep(1);
}
