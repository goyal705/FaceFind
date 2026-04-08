// ══ UPLOAD ════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const uploadZone = document.getElementById("upload-zone");
  const fileInput = document.getElementById("file-input");
//   const deleteModal = document.getElementById("delete-modal");

  if (uploadZone && fileInput) {
    uploadZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploadZone.classList.add("drag");
    });

    uploadZone.addEventListener("dragleave", () => {
      uploadZone.classList.remove("drag");
    });

    uploadZone.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadZone.classList.remove("drag");
      handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
  }

//   if (deleteModal) {
//     deleteModal.addEventListener("click", (e) => {
//       if (e.target === e.currentTarget) closeDeleteModal();
//     });
//   }
});


function handleFiles(files) {
    console.log("handleFiles called", files)
  const valid = [...files]
    .filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type))
    .map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      id: null,
      status: "waiting",
      barEl: null,
      statusEl: null,
    }));
    console.log("valid files", valid.length);
  if (!valid.length) {
    toast("No valid images selected", "err");
    return;
  }
  queue.push(...valid);
  console.log("queue length after push", queue.length);
  renderQueue();
  document.getElementById("queue-wrap").classList.remove("hidden");
  toast(`${valid.length} photo(s) added to queue`);
}

function renderQueue() {
  const list = document.getElementById("queue-list");
  list.innerHTML = "";
  queue.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "queue-item";
    div.innerHTML = `
      <img class="queue-thumb" src="${item.url}">
      <div class="queue-info">
        <div class="queue-name">${esc(item.file.name)}</div>
        <div class="queue-size">${(item.file.size / 1024 / 1024).toFixed(1)} MB</div>
        <div class="queue-bar-wrap"><div class="queue-bar" id="bar-${i}"></div></div>
      </div>
      <div class="queue-status status-${item.status}" id="st-${i}">${labelFor(item.status)}</div>`;
    list.appendChild(div);
    item.barEl = document.getElementById(`bar-${i}`);
    item.statusEl = document.getElementById(`st-${i}`);
  });
  updateProgress();
}

const labelFor = (s) =>
  ({
    waiting: "Waiting",
    uploading: "Uploading…",
    indexing: "Indexing…",
    done: "✓ Done",
    error: "✗ Error",
  })[s] || s;
function updateProgress() {
  const done = queue.filter((q) => q.status === "done").length,
    total = queue.length;
  document.getElementById("progress-summary").textContent =
    `${done} / ${total} done`;
}

async function startUpload() {
  if (!uploadToken) {
    toast("No event token", "err");
    return;
  }
  if (!currentEvent) {
    toast("Event not loaded", "err");
    return;
  }
  const btn = document.getElementById("upload-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Processing…';
  // const opts = new faceapi.TinyFaceDetectorOptions({
  //   inputSize: 320,
  //   scoreThreshold: 0.5,
  // });
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.status === "done") continue;
    setItemStatus(item, "uploading");
    try {
      const fd = new FormData();
      fd.append("event_token", uploadToken);
      fd.append("files", item.file);
      const res = await fetch(`${API}/photos/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      item.id = data[0].id;
      item.barEl.style.width = "50%";
    } catch (e) {
      setItemStatus(item, "error");
      continue;
    }
    item.barEl.style.width = "100%"
    setItemStatus(item, "indexing");
    setItemStatus(item, "done");
    // try {
    //   const img = await new Promise((res, rej) => {
    //     const im = new Image();
    //     im.onload = () => res(im);
    //     im.onerror = rej;
    //     im.src = item.url;
    //   });
    //   const dets = await faceapi
    //     .detectAllFaces(img, opts)
    //     .withFaceLandmarks(true)
    //     .withFaceDescriptors();
    //   const descs = dets.map((d) => Array.from(d.descriptor));
    //   await api("POST", `/photos/${item.id}/descriptors`, {
    //     descriptors: descs,
    //   });
    //   item.barEl.style.width = "100%";
    //   setItemStatus(item, "done");
    // } catch (e) {
    //   setItemStatus(item, "error");
    // }
  }
  btn.innerHTML = "⬆ Upload &amp; Index All";
  btn.disabled = false;
  updateProgress();
  const done = queue.filter((q) => q.status === "done").length;
  toast(`Done! ${done} photo(s) uploaded & indexed 🎉`);
  await loadGallery(); // refresh gallery after upload
}

function setItemStatus(item, status) {
  item.status = status;
  item.barEl.className = `queue-bar ${status}`;
  if (status === "uploading") item.barEl.style.width = "30%";
  item.statusEl.className = `queue-status status-${status}`;
  item.statusEl.textContent = labelFor(status);
  updateProgress();
}