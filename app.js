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

      const cropped = document.createElement("canvas");
      cropped.width = outW;
      cropped.height = outH;
      cv.imshow(cropped,dst);

      // v2.0.2: add a small clean safety margin after perspective correction
      // so the page edge never feels clipped or uncomfortably tight.
      const margin = Math.max(8, Math.round(Math.min(outW, outH) * 0.018));
      const out = document.createElement("canvas");
      out.width = outW + margin * 2;
      out.height = outH + margin * 2;

      const octx = out.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(cropped, margin, margin);

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

  function rotateCanvas90(canvas, clockwise = true) {
    const rotated = document.createElement("canvas");
    rotated.width = canvas.height;
    rotated.height = canvas.width;

    const ctx = rotated.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rotated.width, rotated.height);
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

    return rotated;
  }

  function normaliseScannerOrientation(canvas) {
    // Camera sensors commonly deliver a landscape pixel buffer even while the
    // phone is held portrait. Match the scan to the user's current device
    // orientation, while the existing Rotate control remains the fallback for
    // genuinely landscape documents.
    const phonePortrait = window.innerHeight >= window.innerWidth;
    const scanPortrait = canvas.height >= canvas.width;

    if (phonePortrait !== scanPortrait) {
      return rotateCanvas90(canvas, true);
    }

    return canvas;
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
        finalCanvas = normaliseScannerOrientation(finalCanvas);
        enhanceDocument(finalCanvas);
      } else {
        finalCanvas = normaliseScannerOrientation(finalCanvas);
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
    if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || /\.xlsx$/i.test(file.name)) return "xlsx";
    if (file.type === "application/vnd.ms-excel" || /\.xls$/i.test(file.name)) return "xls";
    return "unknown";
  }

  function isSpreadsheetKind(fileKind) {
    return fileKind === "xlsx" || fileKind === "xls";
  }

  function valid(file) {
    return /\.(pdf|jpe?g|png|webp|xlsx?)$/i.test(file.name) ||
      [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel"
      ].includes(file.type);
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

  let xlsxLoadPromise = null;
  let jsZipLoadPromise = null;

  function loadJsZipEngine() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (jsZipLoadPromise) return jsZipLoadPromise;

    jsZipLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      script.onload = () => window.JSZip
        ? resolve(window.JSZip)
        : reject(new Error("EXCEL_LAYOUT_ENGINE_UNAVAILABLE"));
      script.onerror = () => reject(new Error("EXCEL_LAYOUT_ENGINE_UNAVAILABLE"));
      document.head.appendChild(script);
    });

    return jsZipLoadPromise;
  }

  function loadXlsxEngine() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;

    xlsxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = () => window.XLSX
        ? resolve(window.XLSX)
        : reject(new Error("EXCEL_ENGINE_UNAVAILABLE"));
      script.onerror = () => reject(new Error("EXCEL_ENGINE_UNAVAILABLE"));
      document.head.appendChild(script);
    });

    return xlsxLoadPromise;
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
        previewUrl: fileKind === "pdf" || isSpreadsheetKind(fileKind)
          ? null
          : URL.createObjectURL(file),
        pageCount: fileKind === "pdf" || isSpreadsheetKind(fileKind) ? null : 1,
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

      if (item.kind === "pdf" || isSpreadsheetKind(item.kind)) {
        const documentPreview = document.createElement("div");
        documentPreview.className = "pdf-preview";
        documentPreview.textContent = item.kind === "pdf" ? "PDF" : item.kind.toUpperCase();
        preview.appendChild(documentPreview);
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

      if (item.kind !== "pdf" && !isSpreadsheetKind(item.kind)) {
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

    // v2.0.3: adaptive illumination correction.
    // Estimate the slowly-varying paper/background brightness with a heavily
    // blurred copy, then compensate local shadows before the gentle cleanup.
    const base = document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;

    const bctx = base.getContext("2d");
    bctx.filter = `blur(${Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.025))}px)`;
    bctx.drawImage(canvas, 0, 0);
    bctx.filter = "none";

    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const background = bctx.getImageData(0, 0, base.width, base.height);
    const d = original.data;
    const bg = background.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];

      const bgLum = 0.2126 * bg[i] + 0.7152 * bg[i + 1] + 0.0722 * bg[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max - min;

      // Lift local shadow regions toward a consistent paper illumination,
      // but cap the correction to avoid flattening genuine dark content.
      const desiredBg = 220;
      const shadowLift = Math.max(-8, Math.min(42, (desiredBg - bgLum) * 0.34));
      r += shadowLift;
      g += shadowLift;
      b += shadowLift;

      // Recompute after local correction.
      const lum2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Preserve v2.0.2's restrained paper cleanup.
      if (lum2 > 158 && sat < 50) {
        const target = Math.min(250, 198 + (lum2 - 158) * 0.66);
        const paperMix = 0.54;
        r = r * (1 - paperMix) + target * paperMix;
        g = g * (1 - paperMix) + target * paperMix;
        b = b * (1 - paperMix) + target * paperMix;
      } else {
        const contrast = 1.045;
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;

        if (lum2 < 105) {
          r *= 0.985;
          g *= 0.985;
          b *= 0.985;
        }
      }

      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
    }

    ctx.putImageData(original, 0, 0);
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

  function spreadsheetText(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x20-\x7E\n]/g, "?")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function xmlElements(root, localName) {
    return Array.from(root?.getElementsByTagNameNS?.("*", localName) || []);
  }

  function xmlFirst(root, localName) {
    return xmlElements(root, localName)[0] || null;
  }

  function namespacedAttribute(node, localName) {
    if (!node) return null;
    const direct = node.getAttribute(localName) || node.getAttribute(`r:${localName}`);
    if (direct !== null) return direct;
    const attr = Array.from(node.attributes || []).find(item => item.localName === localName);
    return attr ? attr.value : null;
  }

  function normalizeZipPath(basePath, target) {
    if (!target) return "";
    if (target.startsWith("/")) return target.replace(/^\/+/, "");
    const stack = basePath.split("/").filter(Boolean);
    stack.pop();
    target.split("/").forEach(part => {
      if (!part || part === ".") return;
      if (part === "..") stack.pop();
      else stack.push(part);
    });
    return stack.join("/");
  }

  function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
  }

  function parseRgbHex(value) {
    if (!value) return null;
    const hex = String(value).replace(/^#/, "").replace(/^FF/i, "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return PDFLib.rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    );
  }

  function xlsxColor(node) {
    if (!node) return null;
    const rgb = node.getAttribute("rgb");
    if (rgb) return parseRgbHex(rgb);
    const indexed = Number(node.getAttribute("indexed"));
    if (Number.isFinite(indexed)) {
      const palette = {
        0: "000000", 1: "FFFFFF", 2: "FF0000", 3: "00FF00",
        4: "0000FF", 5: "FFFF00", 6: "FF00FF", 7: "00FFFF",
        8: "000000", 9: "FFFFFF", 10: "FF0000", 11: "00FF00",
        12: "0000FF", 13: "FFFF00", 14: "FF00FF", 15: "00FFFF"
      };
      if (palette[indexed]) return parseRgbHex(palette[indexed]);
    }
    return null;
  }

  function borderWidth(style) {
    switch (style) {
      case "hair": return 0.25;
      case "thin": return 0.6;
      case "medium":
      case "mediumDashed":
      case "mediumDashDot":
      case "mediumDashDotDot": return 1.25;
      case "thick": return 2.0;
      case "double": return 2.2;
      case "dashed":
      case "dotted":
      case "dashDot":
      case "dashDotDot": return 0.6;
      default: return 0;
    }
  }

  function parseXlsxStyles(stylesXml) {
    const defaults = {
      fonts: [{ bold: false, italic: false, size: 11, color: null }],
      fills: [null],
      borders: [{ left: 0, right: 0, top: 0, bottom: 0 }],
      xfs: [{ fontId: 0, fillId: 0, borderId: 0, alignment: {} }]
    };
    if (!stylesXml) return defaults;

    try {
      const doc = parseXml(stylesXml);
      const fontsNode = xmlFirst(doc, "fonts");
      const fillsNode = xmlFirst(doc, "fills");
      const bordersNode = xmlFirst(doc, "borders");
      const cellXfsNode = xmlFirst(doc, "cellXfs");

      const fonts = fontsNode
        ? Array.from(fontsNode.children || []).filter(n => n.localName === "font").map(fontNode => {
            const sizeNode = xmlFirst(fontNode, "sz");
            const colorNode = xmlFirst(fontNode, "color");
            return {
              bold: !!xmlFirst(fontNode, "b"),
              italic: !!xmlFirst(fontNode, "i"),
              size: Math.max(5, Math.min(36, Number(sizeNode?.getAttribute("val")) || 11)),
              color: xlsxColor(colorNode)
            };
          })
        : defaults.fonts;

      const fills = fillsNode
        ? Array.from(fillsNode.children || []).filter(n => n.localName === "fill").map(fillNode => {
            const pattern = xmlFirst(fillNode, "patternFill");
            if (!pattern || pattern.getAttribute("patternType") !== "solid") return null;
            return xlsxColor(xmlFirst(pattern, "fgColor"));
          })
        : defaults.fills;

      const borders = bordersNode
        ? Array.from(bordersNode.children || []).filter(n => n.localName === "border").map(borderNode => {
            const side = name => {
              const node = xmlFirst(borderNode, name);
              return borderWidth(node?.getAttribute("style"));
            };
            return {
              left: side("left"), right: side("right"),
              top: side("top"), bottom: side("bottom")
            };
          })
        : defaults.borders;

      const xfs = cellXfsNode
        ? Array.from(cellXfsNode.children || []).filter(n => n.localName === "xf").map(xfNode => {
            const alignment = xmlFirst(xfNode, "alignment");
            return {
              fontId: Number(xfNode.getAttribute("fontId")) || 0,
              fillId: Number(xfNode.getAttribute("fillId")) || 0,
              borderId: Number(xfNode.getAttribute("borderId")) || 0,
              alignment: alignment ? {
                horizontal: alignment.getAttribute("horizontal") || "",
                vertical: alignment.getAttribute("vertical") || "",
                wrapText: alignment.getAttribute("wrapText") === "1",
                shrinkToFit: alignment.getAttribute("shrinkToFit") === "1"
              } : {}
            };
          })
        : defaults.xfs;

      return {
        fonts: fonts.length ? fonts : defaults.fonts,
        fills: fills.length ? fills : defaults.fills,
        borders: borders.length ? borders : defaults.borders,
        xfs: xfs.length ? xfs : defaults.xfs
      };
    } catch {
      return defaults;
    }
  }

  function styleForCell(layout, address) {
    if (!layout?.styles) return null;
    const styleIndex = layout.styleByCell?.get(address);
    if (!Number.isFinite(styleIndex)) return null;
    const xf = layout.styles.xfs[styleIndex] || layout.styles.xfs[0];
    if (!xf) return null;
    return {
      font: layout.styles.fonts[xf.fontId] || layout.styles.fonts[0],
      fill: layout.styles.fills[xf.fillId] || null,
      border: layout.styles.borders[xf.borderId] || layout.styles.borders[0],
      alignment: xf.alignment || {}
    };
  }

  function parsePrintArea(ref, sheetName, XLSX) {
    if (!ref) return null;
    const parts = String(ref).split(",");
    let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
    for (let part of parts) {
      part = part.trim();
      const bang = part.lastIndexOf("!");
      if (bang >= 0) {
        const rawName = part.slice(0, bang).replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
        if (rawName !== sheetName) continue;
        part = part.slice(bang + 1);
      }
      part = part.replace(/\$/g, "");
      try {
        const range = XLSX.utils.decode_range(part);
        minR = Math.min(minR, range.s.r);
        minC = Math.min(minC, range.s.c);
        maxR = Math.max(maxR, range.e.r);
        maxC = Math.max(maxC, range.e.c);
      } catch {
        // Ignore malformed defined-name ranges.
      }
    }
    return maxR >= 0 ? { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } } : null;
  }

  function sheetPrintArea(workbook, sheetName, sheetIndex, XLSX) {
    const names = workbook?.Workbook?.Names || [];
    for (const item of names) {
      if (item?.Name !== "_xlnm.Print_Area") continue;
      if (Number.isFinite(item.Sheet) && item.Sheet !== sheetIndex) continue;
      const parsed = parsePrintArea(item.Ref, sheetName, XLSX);
      if (parsed) return parsed;
    }
    return null;
  }

  function columnWidthPoints(sheet, columnIndex) {
    const meta = sheet?.["!cols"]?.[columnIndex];
    if (meta?.hidden) return 0;
    if (Number.isFinite(meta?.wpx)) return Math.max(2, meta.wpx * 0.75);
    if (Number.isFinite(meta?.wch)) return Math.max(8, meta.wch * 5.55 + 4);
    if (Number.isFinite(meta?.width)) return Math.max(8, meta.width * 5.55 + 4);
    return 48;
  }

  function rowHeightPoints(sheet, rowIndex) {
    const meta = sheet?.["!rows"]?.[rowIndex];
    if (meta?.hidden) return 0;
    if (Number.isFinite(meta?.hpt)) return Math.max(2, meta.hpt);
    if (Number.isFinite(meta?.hpx)) return Math.max(2, meta.hpx * 0.75);
    return 15;
  }

  function cumulativePositions(values) {
    const out = [0];
    for (const value of values) out.push(out[out.length - 1] + value);
    return out;
  }

  function rangeContains(range, r, c) {
    return r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c;
  }

  function mergeForCell(merges, r, c) {
    return merges.find(range => rangeContains(range, r, c)) || null;
  }

  function cellValue(sheet, XLSX, r, c) {
    const address = XLSX.utils.encode_cell({ r, c });
    const cell = sheet?.[address];
    if (!cell) return { text: "", cell: null, address };
    let value = cell.w;
    if (value === undefined || value === null) value = cell.v;
    if (value instanceof Date) value = value.toLocaleDateString();
    return { text: spreadsheetText(value), cell, address };
  }

  function breakLongToken(token, font, size, maxWidth) {
    if (!token) return [""];
    if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];
    const parts = [];
    let current = "";
    for (const ch of token) {
      const candidate = current + ch;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        parts.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  function wrapSpreadsheetText(text, font, size, maxWidth, maxLines = 10) {
    const value = spreadsheetText(text);
    if (!value || maxWidth <= 1) return [];
    const paragraphs = value.split("\n");
    const lines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const rawWord of words) {
        const pieces = breakLongToken(rawWord, font, size, maxWidth);
        for (const word of pieces) {
          const candidate = line ? `${line} ${word}` : word;
          if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            line = candidate;
          } else {
            lines.push(line);
            line = word;
            if (lines.length >= maxLines) break;
          }
        }
        if (lines.length >= maxLines) break;
      }
      if (line && lines.length < maxLines) lines.push(line);
      if (lines.length >= maxLines) break;
    }

    if (lines.length === maxLines) {
      const last = lines[maxLines - 1];
      if (last && !last.endsWith("...")) {
        let clipped = last;
        while (clipped.length && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) {
          clipped = clipped.slice(0, -1);
        }
        lines[maxLines - 1] = clipped ? `${clipped}...` : "";
      }
    }
    return lines;
  }

  function drawCellBorder(page, x, y, width, height, border, scale) {
    const black = PDFLib.rgb(0.12, 0.12, 0.12);
    const draw = (x1, y1, x2, y2, rawWidth) => {
      if (!rawWidth) return;
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: Math.max(0.25, rawWidth * Math.max(0.7, Math.min(1.4, scale))),
        color: black
      });
    };
    draw(x, y, x, y + height, border?.left || 0);
    draw(x + width, y, x + width, y + height, border?.right || 0);
    draw(x, y + height, x + width, y + height, border?.top || 0);
    draw(x, y, x + width, y, border?.bottom || 0);
  }

  function drawFallbackGrid(page, x, y, width, height) {
    page.drawRectangle({
      x, y, width, height,
      borderWidth: 0.45,
      borderColor: PDFLib.rgb(0.78, 0.78, 0.78)
    });
  }

  function pageMarginsFromLayout(layout) {
    const source = layout?.pageMargins || {};
    const toPoints = (value, fallback) => {
      const inches = Number(value);
      if (!Number.isFinite(inches)) return fallback;
      return Math.max(12, Math.min(72, inches * 72));
    };
    return {
      left: toPoints(source.left, 24),
      right: toPoints(source.right, 24),
      top: toPoints(source.top, 24),
      bottom: toPoints(source.bottom, 24)
    };
  }

  function chooseSpreadsheetPage(contentWidth, contentHeight, layout) {
    const portrait = [595.28, 841.89];
    const landscape = [841.89, 595.28];
    const margins = pageMarginsFromLayout(layout);
    const scaleFor = size => Math.min(
      (size[0] - margins.left - margins.right) / Math.max(1, contentWidth),
      (size[1] - margins.top - margins.bottom) / Math.max(1, contentHeight)
    );
    if (layout?.orientation === "portrait") return { size: portrait, margins };
    if (layout?.orientation === "landscape") return { size: landscape, margins };
    return scaleFor(portrait) >= scaleFor(landscape)
      ? { size: portrait, margins }
      : { size: landscape, margins };
  }

  async function parseXlsxLayout(bytes, workbook, XLSX) {
    const empty = new Map();
    let JSZip;
    try {
      JSZip = await loadJsZipEngine();
    } catch {
      return empty;
    }

    try {
      const zip = await JSZip.loadAsync(bytes);
      const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
      const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
      const stylesXml = await zip.file("xl/styles.xml")?.async("text");
      if (!workbookXml || !workbookRelsXml) return empty;

      const styles = parseXlsxStyles(stylesXml || "");
      const wbDoc = parseXml(workbookXml);
      const relDoc = parseXml(workbookRelsXml);
      const rels = new Map();
      xmlElements(relDoc, "Relationship").forEach(rel => {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        if (id && target) rels.set(id, normalizeZipPath("xl/workbook.xml", target));
      });

      const sheets = xmlElements(wbDoc, "sheet");
      const definedNames = xmlElements(wbDoc, "definedName");
      const out = new Map();

      for (let i = 0; i < sheets.length; i++) {
        const sheetNode = sheets[i];
        const name = sheetNode.getAttribute("name") || workbook.SheetNames[i];
        const relId = namespacedAttribute(sheetNode, "id");
        const sheetPath = rels.get(relId);
        if (!name || !sheetPath || !zip.file(sheetPath)) continue;

        const sheetXml = await zip.file(sheetPath).async("text");
        const sheetDoc = parseXml(sheetXml);
        const styleByCell = new Map();
        xmlElements(sheetDoc, "c").forEach(cellNode => {
          const address = cellNode.getAttribute("r");
          const styleIndex = Number(cellNode.getAttribute("s"));
          if (address && Number.isFinite(styleIndex)) styleByCell.set(address, styleIndex);
        });

        let printArea = null;
        for (const node of definedNames) {
          if (node.getAttribute("name") !== "_xlnm.Print_Area") continue;
          const localSheetId = Number(node.getAttribute("localSheetId"));
          if (Number.isFinite(localSheetId) && localSheetId !== i) continue;
          printArea = parsePrintArea(node.textContent, name, XLSX);
          if (printArea) break;
        }

        const pageSetup = xmlFirst(sheetDoc, "pageSetup");
        const pageMargins = xmlFirst(sheetDoc, "pageMargins");
        const layout = {
          styles,
          styleByCell,
          printArea,
          orientation: pageSetup?.getAttribute("orientation") || "",
          fitToOne: pageSetup?.getAttribute("fitToWidth") === "1" &&
            pageSetup?.getAttribute("fitToHeight") === "1",
          pageMargins: pageMargins ? {
            left: pageMargins.getAttribute("left"),
            right: pageMargins.getAttribute("right"),
            top: pageMargins.getAttribute("top"),
            bottom: pageMargins.getAttribute("bottom")
          } : null,
          images: []
        };

        const drawingNode = xmlFirst(sheetDoc, "drawing");
        const drawingRelId = namespacedAttribute(drawingNode, "id");
        if (drawingRelId) {
          const sheetFile = sheetPath.split("/").pop();
          const sheetRelsPath = `${sheetPath.slice(0, sheetPath.lastIndexOf("/"))}/_rels/${sheetFile}.rels`;
          const sheetRelsXml = await zip.file(sheetRelsPath)?.async("text");
          if (sheetRelsXml) {
            const sheetRelsDoc = parseXml(sheetRelsXml);
            const drawingRel = xmlElements(sheetRelsDoc, "Relationship")
              .find(node => node.getAttribute("Id") === drawingRelId);
            const drawingTarget = drawingRel?.getAttribute("Target");
            const drawingPath = normalizeZipPath(sheetPath, drawingTarget);
            const drawingXml = drawingPath && zip.file(drawingPath)
              ? await zip.file(drawingPath).async("text")
              : null;

            if (drawingXml) {
              const drawingDoc = parseXml(drawingXml);
              const drawingFile = drawingPath.split("/").pop();
              const drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf("/"))}/_rels/${drawingFile}.rels`;
              const drawingRelsXml = await zip.file(drawingRelsPath)?.async("text");
              const drawingRels = new Map();
              if (drawingRelsXml) {
                const drawingRelsDoc = parseXml(drawingRelsXml);
                xmlElements(drawingRelsDoc, "Relationship").forEach(rel => {
                  const id = rel.getAttribute("Id");
                  const target = rel.getAttribute("Target");
                  if (id && target) drawingRels.set(id, normalizeZipPath(drawingPath, target));
                });
              }

              const readMarker = marker => {
                if (!marker) return null;
                const number = localName => Number(xmlFirst(marker, localName)?.textContent || 0);
                return {
                  col: number("col"), row: number("row"),
                  colOff: number("colOff") / 12700,
                  rowOff: number("rowOff") / 12700
                };
              };

              const anchors = [
                ...xmlElements(drawingDoc, "twoCellAnchor"),
                ...xmlElements(drawingDoc, "oneCellAnchor")
              ];

              for (const anchor of anchors) {
                const from = readMarker(xmlFirst(anchor, "from"));
                if (!from) continue;
                const to = readMarker(xmlFirst(anchor, "to"));
                const ext = xmlFirst(anchor, "ext");
                const blip = xmlFirst(anchor, "blip");
                const embedId = namespacedAttribute(blip, "embed");
                const mediaPath = drawingRels.get(embedId);
                if (!mediaPath || !zip.file(mediaPath)) continue;
                const extension = mediaPath.split(".").pop()?.toLowerCase();
                if (!["png", "jpg", "jpeg"].includes(extension)) continue;
                const data = await zip.file(mediaPath).async("uint8array");
                layout.images.push({
                  from,
                  to: to || null,
                  widthPt: to ? null : Number(ext?.getAttribute("cx") || 0) / 12700,
                  heightPt: to ? null : Number(ext?.getAttribute("cy") || 0) / 12700,
                  extension,
                  data
                });
              }
            }
          }
        }

        out.set(name, layout);
      }
      return out;
    } catch {
      return empty;
    }
  }

  async function drawSpreadsheetImage(target, page, image, x, y, width, height) {
    try {
      const embedded = image.extension === "png"
        ? await target.embedPng(image.data)
        : await target.embedJpg(image.data);
      if (!embedded || width <= 0 || height <= 0) return;
      page.drawImage(embedded, { x, y, width, height });
    } catch {
      // Ignore unsupported or damaged embedded worksheet images.
    }
  }

  async function addSpreadsheetPages(target, item) {
    const XLSX = await loadXlsxEngine();
    const bytes = await item.file.arrayBuffer();
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellStyles: true,
      cellNF: true
    });

    const regular = await target.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await target.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const layouts = item.kind === "xlsx"
      ? await parseXlsxLayout(bytes, workbook, XLSX)
      : new Map();
    const sheetNames = workbook.SheetNames.length ? workbook.SheetNames : ["Sheet1"];

    for (let sheetIndex = 0; sheetIndex < sheetNames.length; sheetIndex++) {
      const sheetName = sheetNames[sheetIndex];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const layout = layouts.get(sheetName) || null;

      let range = layout?.printArea || sheetPrintArea(workbook, sheetName, sheetIndex, XLSX);
      if (!range) {
        try {
          range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
        } catch {
          range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        }
      }

      // Embedded images can sit in blank rows above the first populated cell.
      // Expand the render range just enough to keep those anchors visible.
      for (const image of layout?.images || []) {
        range.s.r = Math.min(range.s.r, image.from.row);
        range.s.c = Math.min(range.s.c, image.from.col);
        if (image.to) {
          range.e.r = Math.max(range.e.r, image.to.row);
          range.e.c = Math.max(range.e.c, image.to.col);
        }
      }

      const colIndexes = [];
      const rawColWidths = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const width = columnWidthPoints(sheet, c);
        if (width <= 0) continue;
        colIndexes.push(c);
        rawColWidths.push(width);
      }
      const rowIndexes = [];
      const rawRowHeights = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const height = rowHeightPoints(sheet, r);
        if (height <= 0) continue;
        rowIndexes.push(r);
        rawRowHeights.push(height);
      }
      if (!colIndexes.length || !rowIndexes.length) continue;

      const totalWidth = rawColWidths.reduce((sum, value) => sum + value, 0);
      const totalHeight = rawRowHeights.reduce((sum, value) => sum + value, 0);
      const pageChoice = chooseSpreadsheetPage(totalWidth, totalHeight, layout);
      const [pageWidth, pageHeight] = pageChoice.size;
      const { margins } = pageChoice;
      const usableWidth = pageWidth - margins.left - margins.right;
      const usableHeight = pageHeight - margins.top - margins.bottom;
      const wholeSheetScale = Math.min(
        1,
        usableWidth / Math.max(1, totalWidth),
        usableHeight / Math.max(1, totalHeight)
      );
      const onePageCandidate = layout?.fitToOne ||
        (rowIndexes.length <= 90 && colIndexes.length <= 26 && wholeSheetScale >= 0.42);

      const fallbackStyle = !layout?.styleByCell?.size;
      const merges = (sheet["!merges"] || []).filter(merge =>
        merge.e.r >= range.s.r && merge.s.r <= range.e.r &&
        merge.e.c >= range.s.c && merge.s.c <= range.e.c
      );

      const renderPage = async (rowsForPage, scale) => {
        const page = target.addPage(pageChoice.size);
        const colWidths = rawColWidths.map(value => value * scale);
        const pageRawRowHeights = rowsForPage.map(r => rowHeightPoints(sheet, r));
        const rowHeights = pageRawRowHeights.map(value => value * scale);
        const xPos = cumulativePositions(colWidths);
        const yPos = cumulativePositions(rowHeights);
        const colPosition = new Map(colIndexes.map((c, i) => [c, i]));
        const rowPosition = new Map(rowsForPage.map((r, i) => [r, i]));
        const contentHeight = yPos[yPos.length - 1];
        const originX = margins.left + Math.max(0, (usableWidth - xPos[xPos.length - 1]) / 2);
        const topY = pageHeight - margins.top - Math.max(0, (usableHeight - contentHeight) / 2);
        const drawnMerges = new Set();

        for (const r of rowsForPage) {
          const rowLocal = rowPosition.get(r);
          for (const c of colIndexes) {
            const colLocal = colPosition.get(c);
            const merge = mergeForCell(merges, r, c);
            if (merge) {
              const key = `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`;
              if (drawnMerges.has(key)) continue;
              if (!rowPosition.has(merge.s.r) || !rowPosition.has(merge.e.r) ||
                  !colPosition.has(merge.s.c) || !colPosition.has(merge.e.c)) {
                continue;
              }
              drawnMerges.add(key);
            }

            const startR = merge ? merge.s.r : r;
            const endR = merge ? merge.e.r : r;
            const startC = merge ? merge.s.c : c;
            const endC = merge ? merge.e.c : c;
            const localR1 = rowPosition.get(startR);
            const localR2 = rowPosition.get(endR);
            const localC1 = colPosition.get(startC);
            const localC2 = colPosition.get(endC);
            if ([localR1, localR2, localC1, localC2].some(v => v === undefined)) continue;

            const x = originX + xPos[localC1];
            const width = xPos[localC2 + 1] - xPos[localC1];
            const yTop = topY - yPos[localR1];
            const yBottom = topY - yPos[localR2 + 1];
            const height = yTop - yBottom;
            const source = cellValue(sheet, XLSX, startR, startC);
            const style = styleForCell(layout, source.address);

            if (style?.fill) {
              page.drawRectangle({ x, y: yBottom, width, height, color: style.fill });
            }

            if (style?.border && Object.values(style.border).some(Boolean)) {
              drawCellBorder(page, x, yBottom, width, height, style.border, scale);
            } else if (fallbackStyle) {
              drawFallbackGrid(page, x, yBottom, width, height);
            }

            if (!source.text) continue;
            const fontInfo = style?.font || { bold: false, size: 11 };
            const selectedFont = fontInfo.bold ? bold : regular;
            const baseSize = Math.max(5.5, Math.min(16, (fontInfo.size || 11) * scale));
            const padding = Math.max(1.5, Math.min(4, 3 * scale));
            const maxTextWidth = Math.max(1, width - padding * 2);
            const maxTextHeight = Math.max(1, height - padding * 2);
            let fontSize = baseSize;
            let lineHeight = fontSize * 1.15;
            let maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
            let lines = wrapSpreadsheetText(source.text, selectedFont, fontSize, maxTextWidth, maxLines);

            if (style?.alignment?.shrinkToFit && lines.length > 1) {
              while (fontSize > 5 && lines.length > 1) {
                fontSize -= 0.4;
                lineHeight = fontSize * 1.15;
                maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
                lines = wrapSpreadsheetText(source.text, selectedFont, fontSize, maxTextWidth, maxLines);
              }
            }
            if (!lines.length) continue;

            const totalTextHeight = lines.length * lineHeight;
            let firstBaseline;
            const vertical = style?.alignment?.vertical;
            if (vertical === "top") {
              firstBaseline = yTop - padding - fontSize;
            } else if (vertical === "bottom") {
              firstBaseline = yBottom + padding + totalTextHeight - lineHeight + (lineHeight - fontSize) * 0.3;
            } else {
              firstBaseline = yBottom + (height + totalTextHeight) / 2 - lineHeight + (lineHeight - fontSize) * 0.3;
            }

            lines.forEach((line, index) => {
              const textWidth = selectedFont.widthOfTextAtSize(line, fontSize);
              const horizontal = style?.alignment?.horizontal;
              let textX = x + padding;
              if (horizontal === "center" || horizontal === "centerContinuous") {
                textX = x + Math.max(padding, (width - textWidth) / 2);
              } else if (horizontal === "right" || (!horizontal && source.cell?.t === "n")) {
                textX = x + Math.max(padding, width - padding - textWidth);
              }
              page.drawText(line, {
                x: textX,
                y: firstBaseline - index * lineHeight,
                size: fontSize,
                font: selectedFont,
                color: fontInfo.color || PDFLib.rgb(0.05, 0.05, 0.05)
              });
            });
          }
        }

        // Draw embedded worksheet images last so logos and artwork appear above cells.
        for (const image of layout?.images || []) {
          const fromCol = colPosition.get(image.from.col);
          const fromRow = rowPosition.get(image.from.row);
          if (fromCol === undefined || fromRow === undefined) continue;
          const imageX = originX + xPos[fromCol] + image.from.colOff * scale;
          const imageTop = topY - yPos[fromRow] - image.from.rowOff * scale;
          let imageWidth;
          let imageHeight;
          if (image.to) {
            const toCol = colPosition.get(image.to.col);
            const toRow = rowPosition.get(image.to.row);
            if (toCol === undefined || toRow === undefined) continue;
            const imageRight = originX + xPos[toCol] + image.to.colOff * scale;
            const imageBottom = topY - yPos[toRow] - image.to.rowOff * scale;
            imageWidth = imageRight - imageX;
            imageHeight = imageTop - imageBottom;
          } else {
            imageWidth = (image.widthPt || 0) * scale;
            imageHeight = (image.heightPt || 0) * scale;
          }
          await drawSpreadsheetImage(
            target,
            page,
            image,
            imageX,
            imageTop - imageHeight,
            imageWidth,
            imageHeight
          );
        }
      };

      if (onePageCandidate) {
        await renderPage(rowIndexes, wholeSheetScale);
        continue;
      }

      // For genuinely long worksheets, preserve the original column proportions
      // and split only between rows. This avoids the old horizontal fragmentation.
      const widthScale = Math.min(1, usableWidth / Math.max(1, totalWidth));
      const rowsPerPage = [];
      let current = [];
      let currentHeight = 0;
      for (const r of rowIndexes) {
        const scaledHeight = rowHeightPoints(sheet, r) * widthScale;
        if (current.length && currentHeight + scaledHeight > usableHeight) {
          rowsPerPage.push(current);
          current = [];
          currentHeight = 0;
        }
        current.push(r);
        currentHeight += scaledHeight;
      }
      if (current.length) rowsPerPage.push(current);
      for (const pageRows of rowsPerPage) await renderPage(pageRows, widthScale);
    }
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
        } else if (isSpreadsheetKind(item.kind)) {
          await addSpreadsheetPages(output, item);
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
      } else if (text.includes("EXCEL_ENGINE_UNAVAILABLE")) {
        message = "Excel support could not load. Check your connection and try again.";
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
