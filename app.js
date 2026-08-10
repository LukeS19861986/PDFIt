(() => {
  "use strict";

  const { PDFDocument } = PDFLib;

  const fileInput = document.getElementById("fileInput");
  const cameraInput = document.getElementById("cameraInput");
  const dropZone = document.getElementById("dropZone");
  const workspace = document.getElementById("workspace");
  const fileGrid = document.getElementById("fileGrid");
  const addMoreButton = document.getElementById("addMoreButton");
  const takePhotoButton = document.getElementById("takePhotoButton");
  const createButton = document.getElementById("createButton");
  const clearButton = document.getElementById("clearButton");
  const workingCard = document.getElementById("workingCard");
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const progressText = document.getElementById("progressText");
  const resultCard = document.getElementById("resultCard");
  const resultText = document.getElementById("resultText");
  const downloadLink = document.getElementById("downloadLink");
  const anotherButton = document.getElementById("anotherButton");
  const errorCard = document.getElementById("errorCard");
  const errorText = document.getElementById("errorText");
  const tryAgainButton = document.getElementById("tryAgainButton");
  const summaryText = document.getElementById("summaryText");
  const year = document.getElementById("year");

  const MAX_FILE_MB = 150;
  const MAX_TOTAL_MB = 500;

  let items = [];
  let resultUrl = null;
  let dragId = null;

  year.textContent = new Date().getFullYear();

  const uid = () =>
    crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function kind(file) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
    if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "jpg";
    if (file.type === "image/png" || /\.png$/i.test(file.name)) return "png";
    if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "webp";
    return "unknown";
  }

  function valid(file) {
    return /\.(pdf|jpe?g|png|webp)$/i.test(file.name) ||
      ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type);
  }

  function cleanupItem(item) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  function resetResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    resultCard.classList.add("hidden");
  }

  function clearError() {
    errorCard.classList.add("hidden");
  }

  function showError(message) {
    workingCard.classList.add("hidden");
    createButton.disabled = false;
    errorText.textContent = message;
    errorCard.classList.remove("hidden");
  }

  function setProgress(value, text) {
    const safe = Math.max(0, Math.min(100, Math.round(value)));
    progressBar.style.width = `${safe}%`;
    progressPercent.textContent = `${safe}%`;
    if (text) progressText.textContent = text;
  }

  async function getPdfPageCount(file) {
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      return pdf.getPageCount();
    } catch {
      return null;
    }
  }

  function getTotalBytes() {
    return items.reduce((sum, item) => sum + item.file.size, 0);
  }

  async function addFiles(list) {
    clearError();
    resetResult();

    const incoming = Array.from(list || []);
    const accepted = [];
    const rejected = [];

    for (const file of incoming) {
      if (!valid(file)) {
        rejected.push(`${file.name}: unsupported type`);
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        rejected.push(`${file.name}: larger than ${MAX_FILE_MB} MB`);
        continue;
      }
      accepted.push(file);
    }

    const prospectiveTotal = getTotalBytes() + accepted.reduce((s, f) => s + f.size, 0);
    if (prospectiveTotal > MAX_TOTAL_MB * 1024 * 1024) {
      showError(`Please keep the selected files below about ${MAX_TOTAL_MB} MB in total.`);
      return;
    }

    if (!accepted.length) {
      if (rejected.length) showError(rejected[0]);
      return;
    }

    for (const file of accepted) {
      const fileKind = kind(file);
      const item = {
        id: uid(),
        file,
        kind: fileKind,
        previewUrl: fileKind === "pdf" ? null : URL.createObjectURL(file),
        pageCount: fileKind === "pdf" ? null : 1
      };
      items.push(item);

      if (fileKind === "pdf") {
        item.pageCount = await getPdfPageCount(file);
      }
    }

    fileInput.value = "";
    cameraInput.value = "";
    render();
  }

  function moveItem(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    render();
  }

  function render() {
    fileGrid.innerHTML = "";

    items.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "file-card";
      card.draggable = true;
      card.dataset.id = item.id;

      const preview = document.createElement("div");
      preview.className = "file-preview";

      if (item.kind === "pdf") {
        const pdf = document.createElement("div");
        pdf.className = "pdf-preview";
        pdf.textContent = "PDF";
        preview.appendChild(pdf);
      } else {
        const img = document.createElement("img");
        img.src = item.previewUrl;
        img.alt = "";
        preview.appendChild(img);
      }

      if (item.pageCount) {
        const count = document.createElement("span");
        count.className = "page-count";
        count.textContent = item.kind === "pdf"
          ? `${item.pageCount} page${item.pageCount === 1 ? "" : "s"}`
          : "1 page";
        preview.appendChild(count);
      }

      const remove = document.createElement("button");
      remove.className = "remove-file";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${item.file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        cleanupItem(item);
        items.splice(index, 1);
        render();
      });

      const meta = document.createElement("div");
      meta.className = "file-meta";

      const name = document.createElement("div");
      name.className = "file-name";
      name.title = item.file.name;
      name.textContent = item.file.name;

      const type = document.createElement("span");
      type.className = "file-type";
      type.textContent = `${item.kind.toUpperCase()} · ${formatBytes(item.file.size)}`;

      meta.append(name, type);

      const reorder = document.createElement("div");
      reorder.className = "mobile-reorder";

      const leftButton = document.createElement("button");
      leftButton.className = "move-button";
      leftButton.type = "button";
      leftButton.textContent = "←";
      leftButton.setAttribute("aria-label", `Move ${item.file.name} earlier`);
      leftButton.disabled = index === 0;
      leftButton.addEventListener("click", () => moveItem(index, -1));

      const rightButton = document.createElement("button");
      rightButton.className = "move-button";
      rightButton.type = "button";
      rightButton.textContent = "→";
      rightButton.setAttribute("aria-label", `Move ${item.file.name} later`);
      rightButton.disabled = index === items.length - 1;
      rightButton.addEventListener("click", () => moveItem(index, 1));

      reorder.append(leftButton, rightButton);
      card.append(preview, remove, meta, reorder);

      card.addEventListener("dragstart", () => {
        dragId = item.id;
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => {
        dragId = null;
        card.classList.remove("dragging");
        document.querySelectorAll(".file-card").forEach(el => el.classList.remove("drag-over"));
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (dragId && dragId !== item.id) card.classList.add("drag-over");
      });

      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));

      card.addEventListener("drop", (event) => {
        event.preventDefault();
        card.classList.remove("drag-over");

        if (!dragId || dragId === item.id) return;

        const from = items.findIndex(entry => entry.id === dragId);
        const to = items.findIndex(entry => entry.id === item.id);
        if (from < 0 || to < 0) return;

        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        render();
      });

      fileGrid.appendChild(card);
    });

    const pages = items.reduce((sum, item) => sum + (item.pageCount || 0), 0);
    summaryText.textContent = items.length
      ? `${items.length} source file${items.length === 1 ? "" : "s"} · ${pages || "?"} final page${pages === 1 ? "" : "s"} · ${formatBytes(getTotalBytes())}`
      : "";

    workspace.classList.toggle("hidden", items.length === 0);
    dropZone.classList.toggle("hidden", items.length > 0);
  }

  async function decodeToCanvas(file) {
    let source;

    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      const url = URL.createObjectURL(file);
      try {
        source = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const originalWidth = source.width || source.naturalWidth;
    const originalHeight = source.height || source.naturalHeight;

    // Large phone photos can exhaust browser memory. 3200 px keeps them sharp
    // for ordinary A4 output while making the browser much more resilient.
    const maxDimension = 3200;
    const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(originalWidth * scale));
    canvas.height = Math.max(1, Math.round(originalHeight * scale));

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    if (source.close) source.close();
    return canvas;
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function addImagePage(target, item) {
    const canvas = await decodeToCanvas(item.file);

    // PNG preserves PNG/WEBP transparency if present; JPEG keeps photos compact.
    const jpeg = item.kind === "jpg";
    const dataUrl = jpeg
      ? canvas.toDataURL("image/jpeg", 0.93)
      : canvas.toDataURL("image/png");

    const bytes = dataUrlToBytes(dataUrl);
    const embedded = jpeg
      ? await target.embedJpg(bytes)
      : await target.embedPng(bytes);

    const iw = embedded.width;
    const ih = embedded.height;

    // A4-style output with automatic orientation.
    const a4 = [595.28, 841.89];
    const pageSize = iw > ih ? [a4[1], a4[0]] : a4;

    const [pw, ph] = pageSize;
    const margin = 24;
    const scale = Math.min(
      (pw - margin * 2) / iw,
      (ph - margin * 2) / ih
    );

    const width = iw * scale;
    const height = ih * scale;

    const page = target.addPage(pageSize);
    page.drawImage(embedded, {
      x: (pw - width) / 2,
      y: (ph - height) / 2,
      width,
      height
    });
  }

  async function addPdfPages(target, item) {
    const bytes = await item.file.arrayBuffer();

    let source;
    try {
      source = await PDFDocument.load(bytes);
    } catch (error) {
      if (/encrypt|password/i.test(String(error?.message || error))) {
        throw new Error(`PASSWORD_PROTECTED:${item.file.name}`);
      }
      throw error;
    }

    const copied = await target.copyPages(source, source.getPageIndices());
    copied.forEach(page => target.addPage(page));
  }

  async function createPdf() {
    if (!items.length) return;

    clearError();
    resetResult();
    workspace.classList.add("hidden");
    workingCard.classList.remove("hidden");
    createButton.disabled = true;
    setProgress(2, "Preparing files…");

    try {
      const output = await PDFDocument.create();
      const total = items.length;

      for (let i = 0; i < total; i++) {
        const item = items[i];

        setProgress(
          5 + (i / total) * 88,
          `Adding ${item.file.name}…`
        );

        if (item.kind === "pdf") {
          await addPdfPages(output, item);
        } else {
          await addImagePage(output, item);
        }

        setProgress(5 + ((i + 1) / total) * 88);
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setProgress(96, "Finishing your PDF…");

      const bytes = await output.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: "application/pdf" });

      resultUrl = URL.createObjectURL(blob);
      downloadLink.href = resultUrl;
      downloadLink.download = "pdfit.pdf";

      const totalPages = output.getPageCount();
      resultText.textContent =
        `${totalPages} page${totalPages === 1 ? "" : "s"} · ${formatBytes(blob.size)}`;

      setProgress(100, "Done");
      await new Promise(resolve => setTimeout(resolve, 180));

      workingCard.classList.add("hidden");
      resultCard.classList.remove("hidden");
    } catch (error) {
      console.error(error);

      let message = "We couldn't create that PDF. Please try again.";
      const text = String(error?.message || error);

      if (text.startsWith("PASSWORD_PROTECTED:")) {
        const name = text.split(":").slice(1).join(":");
        message = `${name} appears to be password-protected or encrypted.`;
      } else if (/memory|allocation|buffer/i.test(text)) {
        message = "Your browser ran out of memory. Try fewer or smaller files.";
      }

      showError(message);
      workspace.classList.remove("hidden");
    } finally {
      createButton.disabled = false;
    }
  }

  function clearAll() {
    items.forEach(cleanupItem);
    items = [];
    resetResult();
    clearError();
    workingCard.classList.add("hidden");
    render();
  }

  ["dragenter", "dragover"].forEach(name => {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach(name => {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  });

  dropZone.addEventListener("drop", event => {
    addFiles(event.dataTransfer.files);
  });

  dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  cameraInput.addEventListener("change", () => addFiles(cameraInput.files));

  addMoreButton.addEventListener("click", () => fileInput.click());
  takePhotoButton.addEventListener("click", () => cameraInput.click());
  createButton.addEventListener("click", createPdf);
  clearButton.addEventListener("click", clearAll);
  anotherButton.addEventListener("click", clearAll);

  tryAgainButton.addEventListener("click", () => {
    clearError();
    if (items.length) workspace.classList.remove("hidden");
    else render();
  });

  window.addEventListener("beforeunload", () => {
    items.forEach(cleanupItem);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
})();
