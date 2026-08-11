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

  const scannerModal = document.getElementById("scannerModal");
  const scannerClose = document.getElementById("scannerClose");
  const scannerVideo = document.getElementById("scannerVideo");
  const scannerOverlay = document.getElementById("scannerOverlay");
  const scannerViewport = document.getElementById("scannerViewport");
  const scannerStatus = document.getElementById("scannerStatus");
  const scannerHint = document.getElementById("scannerHint");
  const scannerCapture = document.getElementById("scannerCapture");
  const scannerFallback = document.getElementById("scannerFallback");
  const scannerPhotoFallback = document.getElementById("scannerPhotoFallback");


  const MAX_FILE_MB = 150;
  const MAX_TOTAL_MB = 500;

  let items = [];
  let resultUrl = null;
  let dragId = null;

  let scannerStream = null;
  let scannerTimer = null;
  let scannerQuad = null;
  let scannerBusy = false;
  let scannerCvWarned = false;


  year.textContent = new Date().getFullYear();

  const uid = () =>
    crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;


  function cvReady() {
    return typeof window.cv !== "undefined" &&
      window.cv &&
      typeof window.cv.Mat === "function" &&
      typeof window.cv.findContours === "function";
  }

  function scannerMessage(status, hint) {
    if (status) scannerStatus.textContent = status;
    if (hint) scannerHint.textContent = hint;
  }

  function sortQuad(points) {
    const pts = points.map(p => ({ x:p.x, y:p.y }));
    const sum = p => p.x + p.y;
    const diff = p => p.y - p.x;

    const tl = pts.reduce((a,b) => sum(a) < sum(b) ? a : b);
    const br = pts.reduce((a,b) => sum(a) > sum(b) ? a : b);
    const tr = pts.reduce((a,b) => diff(a) < diff(b) ? a : b);
    const bl = pts.reduce((a,b) => diff(a) > diff(b) ? a : b);
    return [tl,tr,br,bl];
  }

  function drawScannerOverlay(quad) {
    const ctx = scannerOverlay.getContext("2d");
    ctx.clearRect(0,0,scannerOverlay.width,scannerOverlay.height);

    if (!quad) {
      scannerCapture.classList.remove("page-found");
      return;
    }

    ctx.save();
    ctx.strokeStyle = "#cbe87c";
    ctx.fillStyle = "rgba(203,232,124,.10)";
    ctx.lineWidth = Math.max(4, scannerOverlay.width / 220);
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    quad.slice(1).forEach(p => ctx.lineTo(p.x,p.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (const p of quad) {
      ctx.beginPath();
      ctx.arc(p.x,p.y,Math.max(7,scannerOverlay.width/120),0,Math.PI*2);
      ctx.fillStyle="#cbe87c";
      ctx.fill();
    }
    ctx.restore();

    scannerCapture.classList.add("page-found");
  }

  function detectDocumentFromVideo() {
    if (!scannerStream || scannerBusy || scannerVideo.readyState < 2) return;

    if (!cvReady()) {
      scannerQuad = null;
      drawScannerOverlay(null);
      if (!scannerCvWarned) {
        scannerMessage("Camera ready", "Loading page detection… You can still capture a normal photo.");
      }
      return;
    }

    scannerCvWarned = true;

    const vw = scannerVideo.videoWidth;
    const vh = scannerVideo.videoHeight;
    if (!vw || !vh) return;

    const maxDim = 640;
    const ratio = Math.min(1, maxDim / Math.max(vw,vh));
    const sw = Math.max(2, Math.round(vw*ratio));
    const sh = Math.max(2, Math.round(vh*ratio));

    const sample = document.createElement("canvas");
    sample.width = sw;
    sample.height = sh;
    sample.getContext("2d").drawImage(scannerVideo,0,0,sw,sh);

    let src, gray, blur, edges, contours, hierarchy, kernel;
    try {
      src = cv.imread(sample);
      gray = new cv.Mat();
      blur = new cv.Mat();
      edges = new cv.Mat();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      kernel = cv.Mat.ones(3,3,cv.CV_8U);

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
      cv.Canny(blur, edges, 55, 155);
      cv.dilate(edges, edges, kernel);
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      let best = null;
      let bestArea = 0;
      const frameArea = sw*sh;

      for (let i=0;i<contours.size();i++) {
        const c = contours.get(i);
        const area = Math.abs(cv.contourArea(c));
        if (area < frameArea*0.12 || area <= bestArea) {
          c.delete();
          continue;
        }

        const peri = cv.arcLength(c,true);
        const approx = new cv.Mat();
        cv.approxPolyDP(c,approx,0.025*peri,true);

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const points = [];
          for (let r=0;r<4;r++) {
            points.push({
              x: approx.intPtr(r,0)[0],
              y: approx.intPtr(r,0)[1]
            });
          }

          const ordered = sortQuad(points);
          const xs = ordered.map(p=>p.x), ys = ordered.map(p=>p.y);
          const width = Math.max(...xs)-Math.min(...xs);
          const height = Math.max(...ys)-Math.min(...ys);

          if (width > sw*.35 && height > sh*.35) {
            best = ordered;
            bestArea = area;
          }
        }

        approx.delete();
        c.delete();
      }

      if (best) {
        const scaleX = vw/sw;
        const scaleY = vh/sh;
        scannerQuad = best.map(p=>({x:p.x*scaleX,y:p.y*scaleY}));
        drawScannerOverlay(scannerQuad);
        scannerMessage("Page found", "Hold steady and tap the shutter.");
      } else {
        scannerQuad = null;
        drawScannerOverlay(null);
        scannerMessage("Looking for page", "Move closer and keep the full sheet inside the frame.");
      }
    } catch (error) {
      console.warn("Live document detection failed:", error);
      scannerQuad = null;
      drawScannerOverlay(null);
      scannerMessage("Camera ready", "Tap the shutter to capture this photo.");
    } finally {
      [src,gray,blur,edges,hierarchy,kernel].forEach(m=>{ try{ if(m) m.delete(); }catch{} });
      try{ if(contours) contours.delete(); }catch{}
    }
  }

  function stopScanner() {
    if (scannerTimer) {
      clearInterval(scannerTimer);
      scannerTimer = null;
    }
    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }
    scannerVideo.srcObject = null;
    scannerQuad = null;
    scannerBusy = false;
    drawScannerOverlay(null);
    scannerModal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  async function openScanner() {
    clearError();

    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInput.click();
      return;
    }

    scannerModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    scannerCapture.disabled = true;
    scannerMessage("Starting camera…", "Allow camera access when your browser asks.");

    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video:{
          facingMode:{ideal:"environment"},
          width:{ideal:1920},
          height:{ideal:1080}
        },
        audio:false
      });

      scannerVideo.srcObject = scannerStream;
      await scannerVideo.play();

      const vw = scannerVideo.videoWidth || 1080;
      const vh = scannerVideo.videoHeight || 1440;
      scannerOverlay.width = vw;
      scannerOverlay.height = vh;
      scannerViewport.style.aspectRatio = `${vw}/${vh}`;

      scannerCapture.disabled = false;
      scannerMessage("Looking for page", "Keep the full page visible. PDFit will outline it when detected.");

      detectDocumentFromVideo();
      scannerTimer = setInterval(detectDocumentFromVideo, 420);
    } catch (error) {
      console.warn("Custom scanner camera unavailable:", error);
      stopScanner();
      cameraInput.click();
    }
  }

  function distance(a,b) {
    return Math.hypot(a.x-b.x,a.y-b.y);
  }

  function warpDocumentCanvas(sourceCanvas, quad) {
    if (!quad || !cvReady()) return sourceCanvas;

    const [tl,tr,br,bl] = sortQuad(quad);
    let outW = Math.round(Math.max(distance(tl,tr), distance(bl,br)));
    let outH = Math.round(Math.max(distance(tl,bl), distance(tr,br)));

    if (outW < 150 || outH < 150) return sourceCanvas;

    const maxOut = 3200;
    const shrink = Math.min(1,maxOut/Math.max(outW,outH));
    outW = Math.max(2,Math.round(outW*shrink));
    outH = Math.max(2,Math.round(outH*shrink));

    let src, srcTri, dstTri, M, dst;
    try {
      src = cv.imread(sourceCanvas);

      srcTri = cv.matFromArray(4,1,cv.CV_32FC2,[
        tl.x,tl.y,
        tr.x,tr.y,
        br.x,br.y,
        bl.x,bl.y
      ]);
      dstTri = cv.matFromArray(4,1,cv.CV_32FC2,[
        0,0,
        outW-1,0,
        outW-1,outH-1,
        0,outH-1
      ]);

      M = cv.getPerspectiveTransform(srcTri,dstTri);
      dst = new cv.Mat();
      cv.warpPerspective(
        src,dst,M,new cv.Size(outW,outH),
        cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255)
      );

      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      cv.imshow(out,dst);
      return out;
    } catch (error) {
      console.warn("Perspective correction failed:", error);
      return sourceCanvas;
    } finally {
      [src,srcTri,dstTri,M,dst].forEach(m=>{ try{ if(m) m.delete(); }catch{} });
    }
  }

  function canvasToJpegFile(canvas, name="scan.jpg") {
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>{
        if (!blob) return reject(new Error("Could not create scan image"));
        resolve(new File([blob],name,{type:"image/jpeg",lastModified:Date.now()}));
      },"image/jpeg",0.92);
    });
  }

  async function captureScannerPage() {
    if (!scannerStream || scannerBusy || scannerVideo.readyState < 2) return;

    scannerBusy = true;
    scannerCapture.disabled = true;
    scannerMessage("Capturing…", "Straightening and cleaning your page.");

    try {
      const frame = document.createElement("canvas");
      frame.width = scannerVideo.videoWidth;
      frame.height = scannerVideo.videoHeight;
      frame.getContext("2d").drawImage(scannerVideo,0,0,frame.width,frame.height);

      let finalCanvas = frame;
      const detected = !!scannerQuad;

      if (detected) {
        finalCanvas = warpDocumentCanvas(frame,scannerQuad);
        enhanceDocument(finalCanvas);
      }

      const file = await canvasToJpegFile(
        finalCanvas,
        detected ? `PDFit-scan-${Date.now()}.jpg` : `PDFit-photo-${Date.now()}.jpg`
      );

      stopScanner();
      await addFiles([file], detected ? "scanner" : "camera");
    } catch (error) {
      console.error(error);
      scannerBusy = false;
      scannerCapture.disabled = false;
      scannerMessage("Try again", "PDFit could not process that frame.");
    }
  }

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

  async function addFiles(list, source = "files") {
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
        pageCount: fileKind === "pdf" ? null : 1,
        rotation: 0,
        source,
        documentMode: source === "camera" ? "auto" : "off",
        documentDetected: null,
        enhancedPreview: null,
        analysingDocument: source === "camera" && fileKind !== "pdf"
      };
      items.push(item);

      if (fileKind === "pdf") {
        item.pageCount = await getPdfPageCount(file);
      } else if (source === "camera") {
        // Analyse camera captures immediately so the user can actually see
        // the scanner behaviour before creating the PDF.
        prepareDocumentPreview(item).finally(() => {
          item.analysingDocument = false;
          render();
        });
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

      let img = null;

      if (item.kind === "pdf") {
        const pdf = document.createElement("div");
        pdf.className = "pdf-preview";
        pdf.textContent = "PDF";
        preview.appendChild(pdf);
      } else {
        img = document.createElement("img");
        const enhancementActive =
          item.documentMode === "on" ||
          (item.documentMode === "auto" && item.documentDetected === true);
        img.src = enhancementActive && item.enhancedPreview
          ? item.enhancedPreview
          : item.previewUrl;
        img.alt = "";
        preview.appendChild(img);

        if (item.source === "camera") {
          const scanStatus = document.createElement("span");
          scanStatus.className = "scan-status";

          if (item.analysingDocument) {
            scanStatus.textContent = "Checking document…";
            scanStatus.classList.add("checking");
          } else if (item.documentDetected === true && enhancementActive) {
            scanStatus.textContent = "Document detected · Enhanced";
            scanStatus.classList.add("enhanced");
          } else if (item.documentDetected === false) {
            scanStatus.textContent = "Photo kept original";
          } else if (item.documentMode === "on") {
            scanStatus.textContent = "Enhanced";
            scanStatus.classList.add("enhanced");
          }

          if (scanStatus.textContent) preview.appendChild(scanStatus);
        }
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
      type.textContent = `${item.kind.toUpperCase()} · ${formatBytes(item.file.size)}` +
        (item.source === "scanner" ? " · SCANNED" : "");

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

      if (item.kind !== "pdf") {
        const rotateButton = document.createElement("button");
        rotateButton.className = "rotate-button";
        rotateButton.type = "button";
        rotateButton.textContent = "↻ Rotate";
        rotateButton.setAttribute("aria-label", `Rotate ${item.file.name} clockwise`);
        rotateButton.addEventListener("click", async () => {
          item.rotation = (item.rotation + 90) % 360;
          item.enhancedPreview = null;
          render();

          if (item.documentMode === "on" ||
              (item.documentMode === "auto" && item.documentDetected === true)) {
            item.analysingDocument = true;
            render();
            await prepareDocumentPreview(item, true);
            item.analysingDocument = false;
            render();
          }
        });
        reorder.appendChild(rotateButton);

        if (item.source !== "scanner") {
          const enhanceButton = document.createElement("button");
          enhanceButton.className = "rotate-button enhance-button";
          enhanceButton.type = "button";
          const enhancementOn =
            item.documentMode === "on" ||
            (item.documentMode === "auto" && item.documentDetected === true);
          enhanceButton.textContent = enhancementOn ? "Original" : "Scan clean";
          enhanceButton.setAttribute(
            "aria-label",
            enhancementOn
              ? `Show original ${item.file.name}`
              : `Apply scanned-document cleanup to ${item.file.name}`
          );
          enhanceButton.addEventListener("click", async () => {
            if (enhancementOn) {
              item.documentMode = "off";
              render();
              return;
            }

            item.documentMode = "on";
            item.analysingDocument = true;
            render();
            await prepareDocumentPreview(item, true);
            item.analysingDocument = false;
            render();
          });
          reorder.appendChild(enhanceButton);
        }
        if (img) {
          img.style.transform = `rotate(${item.rotation}deg)`;
          if (item.rotation === 90 || item.rotation === 270) {
            img.style.width = "75%";
            img.style.height = "133%";
          }
        }
      }

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

    const knownPages = items.every(item => Number.isInteger(item.pageCount));
    if (items.length && knownPages) {
      createButton.textContent = `Create ${pages}-page PDF`;
    } else {
      createButton.textContent = "Create PDF";
    }

    workspace.classList.toggle("hidden", items.length === 0);
    dropZone.classList.toggle("hidden", items.length > 0);
  }

  async function decodeToCanvas(file, rotation = 0) {
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

    rotation = ((rotation || 0) % 360 + 360) % 360;
    if (!rotation) return canvas;

    const rotated = document.createElement("canvas");
    if (rotation === 90 || rotation === 270) {
      rotated.width = canvas.height;
      rotated.height = canvas.width;
    } else {
      rotated.width = canvas.width;
      rotated.height = canvas.height;
    }
    const rctx = rotated.getContext("2d");
    rctx.fillStyle = "#ffffff";
    rctx.fillRect(0, 0, rotated.width, rotated.height);
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate(rotation * Math.PI / 180);
    rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return rotated;
  }

  function makePreviewDataUrl(canvas) {
    // Keep preview memory modest while remaining sharp enough to compare
    // Original vs Enhanced on a phone.
    const max = 1200;
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));

    if (scale === 1) {
      return canvas.toDataURL("image/jpeg", 0.88);
    }

    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.round(canvas.width * scale));
    preview.height = Math.max(1, Math.round(canvas.height * scale));

    const ctx = preview.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, preview.width, preview.height);
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height);

    return preview.toDataURL("image/jpeg", 0.88);
  }

  async function prepareDocumentPreview(item, forceEnhance = false) {
    if (!item || item.kind === "pdf") return;

    try {
      const canvas = await decodeToCanvas(item.file, item.rotation);

      if (item.documentDetected === null || item.source === "camera") {
        item.documentDetected = analyseDocument(canvas);
      }

      const shouldEnhance =
        forceEnhance ||
        item.documentMode === "on" ||
        (item.documentMode === "auto" && item.documentDetected === true);

      if (shouldEnhance) {
        enhanceDocument(canvas);
        item.enhancedPreview = makePreviewDataUrl(canvas);
      } else {
        item.enhancedPreview = null;
      }
    } catch (error) {
      console.warn("Document preview analysis failed:", error);
      item.documentDetected = false;
      item.enhancedPreview = null;
    }
  }

  function analyseDocument(canvas) {
    // Conservative, low-cost document recognition. We sample the image rather
    // than scanning every pixel so large phone photos stay responsive.
    const sample = document.createElement("canvas");
    const max = 320;
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    sample.width = Math.max(1, Math.round(canvas.width * scale));
    sample.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;

    let light = 0, neutral = 0, dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum > 165) light++;
      if (spread < 38) neutral++;
      if (lum < 105) dark++;
      total++;
    }
    const lightRatio = light / total;
    const neutralRatio = neutral / total;
    const darkRatio = dark / total;

    // Paper pages usually contain a substantial pale/neutral field plus some
    // darker ink. This deliberately rejects colourful ordinary photographs.
    return lightRatio > 0.42 && neutralRatio > 0.50 && darkRatio > 0.025;
  }

  function enhanceDocument(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;

    // Gentle scanner-style cleanup: neutralise near-paper pixels, lift uneven
    // paper/shadows, deepen ink and slightly reduce colour cast. It preserves
    // coloured logos/signatures rather than forcing black and white.
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = max - min;

      if (lum > 145 && sat < 55) {
        const lift = Math.min(255, 205 + (lum - 145) * 0.84);
        r = r * 0.18 + lift * 0.82;
        g = g * 0.18 + lift * 0.82;
        b = b * 0.18 + lift * 0.82;
      } else {
        const contrast = 1.12;
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;
        if (lum < 125) {
          r *= 0.93; g *= 0.93; b *= 0.93;
        }
      }
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(image, 0, 0);
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
    const canvas = await decodeToCanvas(item.file, item.rotation);

    if (item.documentMode === "auto" && item.documentDetected === null) {
      item.documentDetected = analyseDocument(canvas);
    }
    const shouldEnhance = item.documentMode === "on" ||
      (item.documentMode === "auto" && item.documentDetected === true);
    if (shouldEnhance) enhanceDocument(canvas);

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
      const stamp = new Date().toISOString().slice(0, 10);
      downloadLink.download = `PDFit-${stamp}.pdf`;

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
  cameraInput.addEventListener("change", () => addFiles(cameraInput.files, "camera"));


  document.querySelector('label[for="cameraInput"]')?.addEventListener("click", event => {
    event.preventDefault();
    openScanner();
  });

  scannerClose.addEventListener("click", stopScanner);
  scannerCapture.addEventListener("click", captureScannerPage);
  scannerFallback.addEventListener("click", () => {
    stopScanner();
    setTimeout(() => cameraInput.click(), 50);
  });
  scannerPhotoFallback.addEventListener("click", () => {
    stopScanner();
    setTimeout(() => fileInput.click(), 50);
  });

  addMoreButton.addEventListener("click", () => fileInput.click());
  takePhotoButton.addEventListener("click", openScanner);
  createButton.addEventListener("click", createPdf);
  clearButton.addEventListener("click", clearAll);
  anotherButton.addEventListener("click", clearAll);

  tryAgainButton.addEventListener("click", () => {
    clearError();
    if (items.length) workspace.classList.remove("hidden");
    else render();
  });

  window.addEventListener("beforeunload", () => {
    if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
    items.forEach(cleanupItem);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
})();
