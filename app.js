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
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // Keep the HTML untouched. Extend the existing file picker acceptance list
  // at runtime so DOCX support remains an invisible functionality change.
  if (fileInput) {
    const acceptedTypes = (fileInput.getAttribute("accept") || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    for (const value of [".docx", DOCX_MIME]) {
      if (!acceptedTypes.includes(value)) acceptedTypes.push(value);
    }
    fileInput.setAttribute("accept", acceptedTypes.join(","));
  }

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
    if (file.type === DOCX_MIME || /\.docx$/i.test(file.name)) return "docx";
    return "unknown";
  }

  function isSpreadsheetKind(fileKind) {
    return fileKind === "xlsx" || fileKind === "xls";
  }

  function valid(file) {
    return /\.(pdf|jpe?g|png|webp|xlsx?|docx)$/i.test(file.name) ||
      [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        DOCX_MIME
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


  let docxSupportLoadPromise = null;

  function loadBrowserScript(src, ready, errorCode) {
    if (ready()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(script => script.src === src);
      if (existing) {
        const started = Date.now();
        const timer = setInterval(() => {
          if (ready()) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - started > 15000) {
            clearInterval(timer);
            reject(new Error(errorCode));
          }
        }, 50);
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => ready() ? resolve() : reject(new Error(errorCode));
      script.onerror = () => reject(new Error(errorCode));
      document.head.appendChild(script);
    });
  }

  function loadDocxSupport() {
    if (window.docx?.renderAsync && window.html2canvas && window.JSZip) {
      return Promise.resolve({ docx: window.docx, html2canvas: window.html2canvas });
    }
    if (docxSupportLoadPromise) return docxSupportLoadPromise;

    docxSupportLoadPromise = (async () => {
      await loadBrowserScript(
        "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
        () => Boolean(window.JSZip),
        "DOCX_ENGINE_UNAVAILABLE"
      );
      await loadBrowserScript(
        "https://cdn.jsdelivr.net/npm/docx-preview@0.4.0/dist/docx-preview.min.js",
        () => Boolean(window.docx?.renderAsync),
        "DOCX_ENGINE_UNAVAILABLE"
      );
      await loadBrowserScript(
        "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
        () => Boolean(window.html2canvas),
        "DOCX_ENGINE_UNAVAILABLE"
      );
      return { docx: window.docx, html2canvas: window.html2canvas };
    })().catch(error => {
      docxSupportLoadPromise = null;
      throw error;
    });

    return docxSupportLoadPromise;
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function waitForDocxAssets(container) {
    const images = Array.from(container.querySelectorAll("img"));
    await Promise.allSettled(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    }));

    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch {}
    }
    await nextPaint();
  }

  async function mountDocx(file) {
    const { docx, html2canvas } = await loadDocxSupport();
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      left: "-20000px",
      top: "0",
      width: "1800px",
      background: "#ffffff",
      pointerEvents: "none",
      zIndex: "-2147483647"
    });

    const styleContainer = document.createElement("div");
    const bodyContainer = document.createElement("div");
    host.append(styleContainer, bodyContainer);
    document.body.appendChild(host);

    try {
      const bytes = await file.arrayBuffer();
      await docx.renderAsync(bytes, bodyContainer, styleContainer, {
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderComments: false,
        renderChanges: false,
        experimental: true,
        useBase64URL: true,
        debug: false
      });

      await waitForDocxAssets(bodyContainer);
      let pages = Array.from(bodyContainer.querySelectorAll(".docx-wrapper > section.docx"));
      if (!pages.length) pages = Array.from(bodyContainer.querySelectorAll("section.docx"));
      if (!pages.length) {
        const fallback = bodyContainer.querySelector(".docx-wrapper") || bodyContainer.firstElementChild;
        if (fallback) pages = [fallback];
      }
      if (!pages.length) throw new Error("DOCX_RENDER_EMPTY");

      return { host, bodyContainer, pages, html2canvas };
    } catch (error) {
      host.remove();
      throw error;
    }
  }

  function docxPageMetrics(element) {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const width = Math.max(1, Math.ceil(rect.width || element.offsetWidth || element.scrollWidth || 816));
    const fullHeight = Math.max(1, Math.ceil(rect.height || element.scrollHeight || element.offsetHeight || 1056));

    // docx-preview renders a Word page with a CSS min-height. A long document
    // without explicit Word page-break markers can therefore grow into one tall
    // section. Recover the intended physical page height from that min-height
    // and split the tall visual rendering into page-sized screenshots.
    const minContentHeight = parseFloat(computed.minHeight) || 0;
    const verticalExtras =
      (parseFloat(computed.paddingTop) || 0) +
      (parseFloat(computed.paddingBottom) || 0) +
      (parseFloat(computed.borderTopWidth) || 0) +
      (parseFloat(computed.borderBottomWidth) || 0);
    const nominalHeight = minContentHeight > 20
      ? minContentHeight + verticalExtras
      : Math.min(fullHeight, Math.max(1, Math.ceil(element.offsetHeight || fullHeight)));
    const pageHeight = Math.max(1, Math.min(fullHeight, Math.ceil(nominalHeight)));
    const chunks = Math.max(1, Math.ceil((fullHeight - 1) / pageHeight));
    return { width, pageHeight, fullHeight, chunks };
  }

  function estimatedDocxPageCount(elements) {
    return elements.reduce((total, element) => total + docxPageMetrics(element).chunks, 0);
  }

  async function captureDocxSection(element, html2canvas, scale = 1.25) {
    const metrics = docxPageMetrics(element);
    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: metrics.width,
      height: metrics.fullHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(document.documentElement.clientWidth || 0, metrics.width + 40),
      windowHeight: Math.max(document.documentElement.clientHeight || 0, Math.min(metrics.fullHeight + 40, 12000))
    });

    const result = [];
    const sourcePageHeight = Math.max(1, Math.round(metrics.pageHeight * scale));
    let sourceY = 0;
    for (let part = 0; part < metrics.chunks && sourceY < canvas.height; part++) {
      const sourceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sourcePageHeight;
      const ctx = slice.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, slice.width, sourceHeight);
      result.push({ canvas: slice, cssWidth: metrics.width, cssHeight: metrics.pageHeight });
      sourceY += sourcePageHeight;
    }

    canvas.width = 1;
    canvas.height = 1;
    return result;
  }

  async function prepareDocxPreview(item) {
    if (!item || item.kind !== "docx") return;
    let mounted = null;
    try {
      mounted = await mountDocx(item.file);
      item.pageCount = estimatedDocxPageCount(mounted.pages);
      const first = await captureDocxSection(mounted.pages[0], mounted.html2canvas, 0.65);
      if (first.length) {
        item.wordPreview = makePreviewDataUrl(first[0].canvas);
        first.forEach(page => {
          page.canvas.width = 1;
          page.canvas.height = 1;
        });
      }
    } catch (error) {
      console.warn("DOCX preview failed:", error);
      item.wordPreview = null;
      item.pageCount = null;
    } finally {
      mounted?.host?.remove();
    }
  }

  function canvasToJpegBytes(canvas, quality = 0.93) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error("DOCX_IMAGE_FAILED"));
          return;
        }
        try {
          resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (error) {
          reject(error);
        }
      }, "image/jpeg", quality);
    });
  }

  async function addDocxPages(target, item) {
    let mounted = null;
    let pagesAdded = 0;
    try {
      mounted = await mountDocx(item.file);
      for (const section of mounted.pages) {
        const captures = await captureDocxSection(section, mounted.html2canvas, 1.35);
        for (const capture of captures) {
          const jpgBytes = await canvasToJpegBytes(capture.canvas, 0.94);
          const embedded = await target.embedJpg(jpgBytes);
          // CSS pixels use 96 dpi; PDF points use 72 dpi.
          const pageWidth = Math.max(72, capture.cssWidth * 0.75);
          const pageHeight = Math.max(72, capture.cssHeight * 0.75);
          const page = target.addPage([pageWidth, pageHeight]);
          page.drawImage(embedded, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight
          });
          capture.canvas.width = 1;
          capture.canvas.height = 1;
          pagesAdded++;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      if (!pagesAdded) throw new Error("DOCX_RENDER_EMPTY");
      item.pageCount = pagesAdded;
    } finally {
      mounted?.host?.remove();
    }
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
        previewUrl: fileKind === "pdf" || isSpreadsheetKind(fileKind) || fileKind === "docx"
          ? null
          : URL.createObjectURL(file),
        pageCount: fileKind === "pdf" || isSpreadsheetKind(fileKind) || fileKind === "docx" ? null : 1,
        rotation: 0,
        source,
        documentMode: source === "camera" ? "auto" : "off",
        documentDetected: null,
        enhancedPreview: null,
        spreadsheetPreview: null,
        spreadsheetPreviewLoading: isSpreadsheetKind(fileKind),
        wordPreview: null,
        wordPreviewLoading: fileKind === "docx",
        analysingDocument: source === "camera" && fileKind !== "pdf"
      };
      items.push(item);

      if (fileKind === "pdf") {
        item.pageCount = await getPdfPageCount(file);
      } else if (isSpreadsheetKind(fileKind)) {
        // Build a lightweight first-sheet thumbnail in the browser. This is
        // presentation-only: the PDF conversion path remains unchanged.
        prepareSpreadsheetPreview(item).finally(() => {
          item.spreadsheetPreviewLoading = false;
          render();
        });
      } else if (fileKind === "docx") {
        prepareDocxPreview(item).finally(() => {
          item.wordPreviewLoading = false;
          render();
        });
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
        const documentPreview = document.createElement("div");
        documentPreview.className = "pdf-preview";
        documentPreview.textContent = "PDF";
        preview.appendChild(documentPreview);
      } else if (item.kind === "docx") {
        if (item.wordPreview) {
          img = document.createElement("img");
          img.src = item.wordPreview;
          img.alt = "";
          preview.appendChild(img);
        } else {
          const documentPreview = document.createElement("div");
          documentPreview.className = "pdf-preview";
          documentPreview.textContent = "DOCX";
          preview.appendChild(documentPreview);
        }
      } else if (isSpreadsheetKind(item.kind)) {
        if (item.spreadsheetPreview) {
          img = document.createElement("img");
          img.src = item.spreadsheetPreview;
          img.alt = "";
          preview.appendChild(img);
        } else {
          const documentPreview = document.createElement("div");
          documentPreview.className = "pdf-preview";
          documentPreview.textContent = item.kind.toUpperCase();
          preview.appendChild(documentPreview);
        }
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
        count.textContent = item.kind === "pdf" || item.kind === "docx"
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
      .replace(/\r?\n/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x20-\x7E]/g, "?")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fitSpreadsheetText(text, font, size, maxWidth) {
    const value = spreadsheetText(text);
    if (!value) return "";
    if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;

    let low = 0;
    let high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = `${value.slice(0, mid)}...`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return low > 0 ? `${value.slice(0, low)}...` : "";
  }

  function xlsU16(view, offset) {
    return view.getUint16(offset, true);
  }

  function xlsU32(view, offset) {
    return view.getUint32(offset, true);
  }

  function xlsF64(view, offset) {
    return view.getFloat64(offset, true);
  }

  function xlsConcat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function xlsUtf16Name(bytes, offset, byteLength) {
    let out = "";
    for (let i = 0; i + 1 < byteLength; i += 2) {
      const code = bytes[offset + i] | (bytes[offset + i + 1] << 8);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function xlsWorkbookStream(sourceBytes) {
    const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
    if (bytes.length < 512) return null;
    const signature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (!signature.every((value, i) => bytes[i] === value)) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorSize = 1 << xlsU16(view, 30);
    const miniSectorSize = 1 << xlsU16(view, 32);
    const fatCount = xlsU32(view, 44);
    const firstDirectorySector = xlsU32(view, 48);
    const miniCutoff = xlsU32(view, 56);
    const firstMiniFatSector = xlsU32(view, 60);
    const miniFatCount = xlsU32(view, 64);
    const firstDifatSector = xlsU32(view, 68);
    const difatCount = xlsU32(view, 72);
    const FREE = 0xFFFFFFFF;
    const END = 0xFFFFFFFE;

    const sector = sectorId => {
      const start = (sectorId + 1) * sectorSize;
      const end = Math.min(bytes.length, start + sectorSize);
      return start >= 0 && start < bytes.length ? bytes.subarray(start, end) : new Uint8Array();
    };

    const difat = [];
    for (let i = 0; i < 109; i++) {
      const value = xlsU32(view, 76 + i * 4);
      if (value !== FREE && value !== END) difat.push(value);
    }

    let difatSector = firstDifatSector;
    for (let i = 0; i < difatCount && difatSector !== FREE && difatSector !== END; i++) {
      const chunk = sector(difatSector);
      if (chunk.length < sectorSize) break;
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const entries = sectorSize / 4;
      for (let j = 0; j < entries - 1; j++) {
        const value = xlsU32(chunkView, j * 4);
        if (value !== FREE && value !== END) difat.push(value);
      }
      difatSector = xlsU32(chunkView, (entries - 1) * 4);
    }

    const fat = [];
    for (const fatSector of difat.slice(0, fatCount)) {
      const chunk = sector(fatSector);
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let offset = 0; offset + 4 <= chunk.length; offset += 4) {
        fat.push(xlsU32(chunkView, offset));
      }
    }

    const followChain = (start, table, limit = 200000) => {
      const ids = [];
      const seen = new Set();
      let current = start >>> 0;
      while (current !== END && current !== FREE && current < table.length && !seen.has(current) && ids.length < limit) {
        ids.push(current);
        seen.add(current);
        current = table[current] >>> 0;
      }
      return ids;
    };

    const directoryBytes = xlsConcat(followChain(firstDirectorySector, fat).map(sector));
    const directory = [];
    for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
      const entry = directoryBytes.subarray(offset, offset + 128);
      const entryView = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
      const nameLength = xlsU16(entryView, 64);
      const name = nameLength >= 2 ? xlsUtf16Name(entry, 0, Math.min(64, nameLength - 2)) : "";
      directory.push({
        name,
        type: entry[66],
        start: xlsU32(entryView, 116),
        size: xlsU32(entryView, 120)
      });
    }

    const workbookEntry = directory.find(entry => entry.type === 2 && (entry.name === "Workbook" || entry.name === "Book"));
    if (!workbookEntry) return null;

    const readRegularStream = entry => xlsConcat(followChain(entry.start, fat).map(sector)).subarray(0, entry.size);
    if (workbookEntry.size >= miniCutoff) return readRegularStream(workbookEntry);

    const root = directory.find(entry => entry.type === 5);
    if (!root) return null;
    const rootStream = readRegularStream(root);
    const miniFat = [];
    if (miniFatCount && firstMiniFatSector !== FREE && firstMiniFatSector !== END) {
      const miniFatBytes = xlsConcat(followChain(firstMiniFatSector, fat).slice(0, miniFatCount).map(sector));
      const miniView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
      for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) miniFat.push(xlsU32(miniView, offset));
    }
    if (!miniFat.length) return null;
    const miniParts = followChain(workbookEntry.start, miniFat).map(miniId => {
      const start = miniId * miniSectorSize;
      return rootStream.subarray(start, start + miniSectorSize);
    });
    return xlsConcat(miniParts).subarray(0, workbookEntry.size);
  }

  function xlsBiffRecords(workbookBytes, start = 0) {
    const out = [];
    const view = new DataView(workbookBytes.buffer, workbookBytes.byteOffset, workbookBytes.byteLength);
    let pos = start;
    while (pos + 4 <= workbookBytes.length) {
      const id = xlsU16(view, pos);
      const length = xlsU16(view, pos + 2);
      const payloadStart = pos + 4;
      const payloadEnd = payloadStart + length;
      if (payloadEnd > workbookBytes.length) break;
      out.push({ id, length, pos, payload: workbookBytes.subarray(payloadStart, payloadEnd) });
      pos = payloadEnd;
      if (start && id === 0x000A) break;
    }
    return out;
  }

  function xlsFont(payload) {
    if (payload.length < 16) return { size: 11, bold: false };
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    return {
      size: Math.max(5, Math.min(36, xlsU16(view, 0) / 20 || 11)),
      bold: xlsU16(view, 6) >= 700
    };
  }

  function xlsBorderWidth(style) {
    switch (style) {
      case 1: return 0.6;
      case 2: return 1.35;
      case 3:
      case 4:
      case 7:
      case 8:
      case 9:
      case 10: return 0.7;
      case 5: return 2.0;
      case 6: return 2.2;
      case 11:
      case 12:
      case 13: return 1.25;
      default: return 0;
    }
  }

  function xlsXf(payload) {
    if (payload.length < 20) return null;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const border1 = xlsU32(view, 10);
    const alignment = payload[6];
    return {
      fontIndex: xlsU16(view, 0),
      horizontal: alignment & 0x07,
      wrapText: !!(alignment & 0x08),
      left: xlsBorderWidth(border1 & 0x0F),
      right: xlsBorderWidth((border1 >>> 4) & 0x0F),
      top: xlsBorderWidth((border1 >>> 8) & 0x0F),
      bottom: xlsBorderWidth((border1 >>> 12) & 0x0F)
    };
  }

  function xlsSheetName(payload) {
    if (payload.length < 8) return "";
    const count = payload[6];
    const wide = !!(payload[7] & 0x01);
    if (wide) {
      let out = "";
      for (let i = 0; i < count && 8 + i * 2 + 1 < payload.length; i++) {
        out += String.fromCharCode(payload[8 + i * 2] | (payload[9 + i * 2] << 8));
      }
      return out;
    }
    let out = "";
    for (let i = 0; i < count && 8 + i < payload.length; i++) out += String.fromCharCode(payload[8 + i]);
    return out;
  }

  function xlsExtractPngs(buffer) {
    const images = [];
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i + 8 <= buffer.length; i++) {
      let match = true;
      for (let j = 0; j < sig.length; j++) if (buffer[i + j] !== sig[j]) { match = false; break; }
      if (!match) continue;
      let pos = i + 8;
      let end = -1;
      while (pos + 12 <= buffer.length) {
        const length = ((buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3]) >>> 0;
        if (length > buffer.length - pos - 12) break;
        const type = String.fromCharCode(buffer[pos + 4], buffer[pos + 5], buffer[pos + 6], buffer[pos + 7]);
        pos += 12 + length;
        if (type === "IEND") { end = pos; break; }
      }
      if (end > i) {
        images.push({ extension: "png", data: buffer.slice(i, end) });
        i = end - 1;
      }
    }
    return images;
  }

  function xlsEscherAnchors(buffer) {
    const anchors = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const walk = (start, end) => {
      let pos = start;
      while (pos + 8 <= end) {
        const verInst = xlsU16(view, pos);
        const type = xlsU16(view, pos + 2);
        const length = xlsU32(view, pos + 4);
        const payloadStart = pos + 8;
        const payloadEnd = payloadStart + length;
        if (payloadEnd > end) break;
        if ((verInst & 0x0F) === 0x0F) {
          walk(payloadStart, payloadEnd);
        } else if (type === 0xF010 && length >= 18) {
          const flag = xlsU16(view, payloadStart);
          anchors.push({
            flag,
            from: {
              col: xlsU16(view, payloadStart + 2),
              colFrac: xlsU16(view, payloadStart + 4) / 1024,
              row: xlsU16(view, payloadStart + 6),
              rowFrac: xlsU16(view, payloadStart + 8) / 256
            },
            to: {
              col: xlsU16(view, payloadStart + 10),
              colFrac: xlsU16(view, payloadStart + 12) / 1024,
              row: xlsU16(view, payloadStart + 14),
              rowFrac: xlsU16(view, payloadStart + 16) / 256
            }
          });
        }
        pos = payloadEnd;
      }
    };
    walk(0, buffer.length);
    return anchors;
  }

  function parseLegacyXlsLayout(sourceBytes) {
    const workbookBytes = xlsWorkbookStream(sourceBytes);
    if (!workbookBytes) return null;
    const globalRecords = xlsBiffRecords(workbookBytes);
    const bounds = [];
    const fonts = [];
    const xfs = [];
    const drawingGroupParts = [];
    let inDrawingGroup = false;

    let fontRecordIndex = 0;
    for (const record of globalRecords) {
      if (record.id === 0x0085 && record.payload.length >= 8) {
        const v = new DataView(record.payload.buffer, record.payload.byteOffset, record.payload.byteLength);
        bounds.push({ offset: xlsU32(v, 0), name: xlsSheetName(record.payload) });
      } else if (record.id === 0x0031) {
        const fontIndex = fontRecordIndex < 4 ? fontRecordIndex : fontRecordIndex + 1;
        fonts[fontIndex] = xlsFont(record.payload);
        fontRecordIndex++;
      } else if (record.id === 0x00E0) {
        xfs.push(xlsXf(record.payload));
      }

      if (record.id === 0x00EB) {
        drawingGroupParts.push(record.payload);
        inDrawingGroup = true;
      } else if (record.id === 0x003C && inDrawingGroup) {
        drawingGroupParts.push(record.payload);
      } else if (inDrawingGroup) {
        inDrawingGroup = false;
      }
    }

    const globalImages = drawingGroupParts.length ? xlsExtractPngs(xlsConcat(drawingGroupParts)) : [];
    let imageCursor = 0;
    const sheets = new Map();

    for (let sheetIndex = 0; sheetIndex < bounds.length; sheetIndex++) {
      const bound = bounds[sheetIndex];
      const sheetRecords = xlsBiffRecords(workbookBytes, bound.offset);
      const cols = new Map();
      const rows = new Map();
      const styleByCell = new Map();
      const merges = [];
      let range = null;
      let orientation = "";
      let fitToOne = false;
      const pageMargins = {};
      const drawingParts = [];
      let inDrawing = false;

      const setStyle = (r, c, xf) => styleByCell.set(`${r}:${c}`, xf);

      for (const record of sheetRecords) {
        const p = record.payload;
        const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
        if (record.id === 0x0200 && p.length >= 12) {
          const firstRow = xlsU32(v, 0);
          const lastRow = xlsU32(v, 4);
          const firstCol = xlsU16(v, 8);
          const lastCol = xlsU16(v, 10);
          range = { s: { r: firstRow, c: firstCol }, e: { r: Math.max(firstRow, lastRow - 1), c: Math.max(firstCol, lastCol - 1) } };
        } else if (record.id === 0x007D && p.length >= 12) {
          const first = xlsU16(v, 0);
          const last = Math.min(255, xlsU16(v, 2));
          const rawWidth = xlsU16(v, 4);
          const flags = xlsU16(v, 8);
          const width = Math.max(2, (rawWidth / 256) * 5.55 + 4);
          for (let c = first; c <= last; c++) cols.set(c, { width, hidden: !!(flags & 0x0001) });
        } else if (record.id === 0x0208 && p.length >= 16) {
          const row = xlsU16(v, 0);
          const height = xlsU16(v, 6) / 20;
          rows.set(row, { height: Math.max(2, height || 15), hidden: false });
        } else if (record.id === 0x00E5 && p.length >= 2) {
          const count = xlsU16(v, 0);
          for (let i = 0; i < count && 2 + i * 8 + 8 <= p.length; i++) {
            const off = 2 + i * 8;
            merges.push({
              s: { r: xlsU16(v, off), c: xlsU16(v, off + 4) },
              e: { r: xlsU16(v, off + 2), c: xlsU16(v, off + 6) }
            });
          }
        } else if (record.id === 0x00A1 && p.length >= 12) {
          const fitWidth = xlsU16(v, 6);
          const fitHeight = xlsU16(v, 8);
          const flags = xlsU16(v, 10);
          orientation = flags & 0x0002 ? "portrait" : "landscape";
          fitToOne = fitWidth === 1 && fitHeight === 1;
        } else if ([0x0026, 0x0027, 0x0028, 0x0029].includes(record.id) && p.length >= 8) {
          const key = record.id === 0x0026 ? "left" : record.id === 0x0027 ? "right" : record.id === 0x0028 ? "top" : "bottom";
          pageMargins[key] = xlsF64(v, 0);
        } else if ([0x00FD, 0x0201, 0x0203, 0x027E, 0x0006, 0x0204, 0x0205].includes(record.id) && p.length >= 6) {
          setStyle(xlsU16(v, 0), xlsU16(v, 2), xlsU16(v, 4));
        } else if (record.id === 0x00BE && p.length >= 6) {
          const r = xlsU16(v, 0);
          const firstCol = xlsU16(v, 2);
          const lastCol = xlsU16(v, p.length - 2);
          for (let c = firstCol; c <= lastCol; c++) {
            const off = 4 + (c - firstCol) * 2;
            if (off + 2 <= p.length - 2) setStyle(r, c, xlsU16(v, off));
          }
        } else if (record.id === 0x00BD && p.length >= 12) {
          const r = xlsU16(v, 0);
          const firstCol = xlsU16(v, 2);
          const lastCol = xlsU16(v, p.length - 2);
          for (let c = firstCol; c <= lastCol; c++) {
            const off = 4 + (c - firstCol) * 6;
            if (off + 2 <= p.length - 2) setStyle(r, c, xlsU16(v, off));
          }
        }

        if (record.id === 0x00EC) {
          drawingParts.push(record.payload);
          inDrawing = true;
        } else if (record.id === 0x003C && inDrawing) {
          drawingParts.push(record.payload);
        } else if (inDrawing) {
          inDrawing = false;
        }
      }

      if (!range) range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      const anchors = drawingParts.length ? xlsEscherAnchors(xlsConcat(drawingParts)) : [];
      const images = [];
      for (const anchor of anchors) {
        const image = globalImages[imageCursor++];
        if (!image) break;
        images.push({ ...image, ...anchor });
        range.s.r = Math.min(range.s.r, anchor.from.row);
        range.s.c = Math.min(range.s.c, anchor.from.col);
        range.e.r = Math.max(range.e.r, anchor.to.row);
        range.e.c = Math.max(range.e.c, anchor.to.col);
      }

      sheets.set(bound.name || `Sheet${sheetIndex + 1}`, {
        legacy: true,
        range,
        cols,
        rows,
        merges,
        styleByCell,
        fonts,
        xfs,
        orientation,
        fitToOne,
        pageMargins,
        images
      });
    }

    return sheets;
  }

  function xlsStyleForCell(layout, r, c) {
    const xfIndex = layout?.styleByCell?.get(`${r}:${c}`);
    const xf = Number.isFinite(xfIndex) ? layout.xfs?.[xfIndex] : null;
    if (!xf) return { font: { size: 11, bold: false }, left: 0, right: 0, top: 0, bottom: 0, horizontal: 0, wrapText: false };
    return {
      ...xf,
      font: layout.fonts?.[xf.fontIndex] || { size: 11, bold: false }
    };
  }

  function xlsMergeForCell(layout, r, c) {
    return (layout?.merges || []).find(merge =>
      r >= merge.s.r && r <= merge.e.r && c >= merge.s.c && c <= merge.e.c
    ) || null;
  }

  function xlsCellSource(sheet, XLSX, r, c) {
    const address = XLSX.utils.encode_cell({ r, c });
    const cell = sheet?.[address];
    if (!cell) return { text: "", cell: null, address };
    let value = cell.w;
    if (value === undefined || value === null) value = cell.v;
    if (value instanceof Date) value = value.toLocaleDateString();
    return { text: spreadsheetText(value), cell, address };
  }

  function xlsLegacyMargins(layout) {
    const source = layout?.pageMargins || {};
    const pointMargin = (value, fallback) => {
      const inches = Number(value);
      if (!Number.isFinite(inches)) return fallback;
      return Math.max(fallback, Math.min(72, inches * 72));
    };
    return {
      left: pointMargin(source.left, 24),
      right: pointMargin(source.right, 24),
      top: pointMargin(source.top, 26),
      bottom: pointMargin(source.bottom, 26)
    };
  }

  function xlsLegacyMergedBorder(layout, merge) {
    let left = 0, right = 0, top = 0, bottom = 0;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      left = Math.max(left, xlsStyleForCell(layout, r, merge.s.c).left || 0);
      right = Math.max(right, xlsStyleForCell(layout, r, merge.e.c).right || 0);
    }
    for (let c = merge.s.c; c <= merge.e.c; c++) {
      top = Math.max(top, xlsStyleForCell(layout, merge.s.r, c).top || 0);
      bottom = Math.max(bottom, xlsStyleForCell(layout, merge.e.r, c).bottom || 0);
    }
    return { left, right, top, bottom };
  }

  function xlsDrawBorder(page, x, y, width, height, border, scale) {
    const black = PDFLib.rgb(0.08, 0.08, 0.08);
    const draw = (x1, y1, x2, y2, rawWidth) => {
      if (!rawWidth) return;
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: Math.max(0.25, rawWidth * Math.max(0.78, Math.min(1.15, scale))),
        color: black
      });
    };
    draw(x, y, x, y + height, border?.left || 0);
    draw(x + width, y, x + width, y + height, border?.right || 0);
    draw(x, y + height, x + width, y + height, border?.top || 0);
    draw(x, y, x + width, y, border?.bottom || 0);
  }

  function xlsLegacyTextWidth(layout, sheet, XLSX, r, c, range, xPos, originX) {
    const startLocal = c - range.s.c;
    let rightLocal = startLocal + 1;
    let currentCol = c;
    let currentStyle = xlsStyleForCell(layout, r, c);

    while (currentCol < range.e.c && currentStyle.right === 0) {
      const nextCol = currentCol + 1;
      const nextSource = xlsCellSource(sheet, XLSX, r, nextCol);
      if (nextSource.text) break;
      const nextStyle = xlsStyleForCell(layout, r, nextCol);
      if (nextStyle.left !== 0) break;
      currentCol = nextCol;
      rightLocal = currentCol - range.s.c + 1;
      currentStyle = nextStyle;
    }

    return originX + xPos[rightLocal] - (originX + xPos[startLocal]);
  }


  function loadSpreadsheetPreviewImage(data, extension) {
    return new Promise((resolve, reject) => {
      const type = extension === "png" ? "image/png" : "image/jpeg";
      const url = URL.createObjectURL(new Blob([data], { type }));
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SPREADSHEET_PREVIEW_IMAGE_FAILED"));
      };
      image.src = url;
    });
  }

  function drawSpreadsheetPreviewBorder(ctx, x, y, width, height, border, scale) {
    ctx.strokeStyle = "#202020";
    ctx.lineCap = "butt";
    const draw = (x1, y1, x2, y2, rawWidth) => {
      if (!rawWidth) return;
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.25, rawWidth * Math.max(0.78, Math.min(1.15, scale)));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    draw(x, y, x, y + height, border?.left || 0);
    draw(x + width, y, x + width, y + height, border?.right || 0);
    draw(x, y, x + width, y, border?.top || 0);
    draw(x, y + height, x + width, y + height, border?.bottom || 0);
  }

  async function renderLegacyXlsSpreadsheetPreview(workbook, XLSX, layouts) {
    if (!layouts?.size || !workbook?.SheetNames?.length) return null;

    let sheetName = null;
    let layout = null;
    let sheet = null;
    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const candidateName = workbook.SheetNames[i];
      const candidateLayout = layouts.get(candidateName) || Array.from(layouts.values())[i];
      const candidateSheet = workbook.Sheets[candidateName];
      if (candidateLayout?.legacy && candidateSheet) {
        sheetName = candidateName;
        layout = candidateLayout;
        sheet = candidateSheet;
        break;
      }
    }
    if (!sheetName || !layout || !sheet) return null;

    const range = {
      s: { r: layout.range.s.r, c: layout.range.s.c },
      e: { r: layout.range.e.r, c: layout.range.e.c }
    };
    const colWidths = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const meta = layout.cols.get(c);
      colWidths.push(meta?.hidden ? 0 : Math.max(2, meta?.width || 48));
    }
    const rowHeights = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const meta = layout.rows.get(r);
      rowHeights.push(meta?.hidden ? 0 : Math.max(2, meta?.height || 15));
    }

    const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);
    const totalHeight = rowHeights.reduce((sum, value) => sum + value, 0);
    if (!totalWidth || !totalHeight) return null;

    const portrait = [595.28, 841.89];
    const landscape = [841.89, 595.28];
    const pageSize = layout.orientation === "landscape" ? landscape : portrait;
    const [pageWidth, pageHeight] = pageSize;
    const margins = xlsLegacyMargins(layout);
    const usableWidth = pageWidth - margins.left - margins.right;
    const usableHeight = pageHeight - margins.top - margins.bottom;
    const scale = Math.min(
      1,
      usableWidth / Math.max(1, totalWidth),
      usableHeight / Math.max(1, totalHeight)
    );

    const xPos = [0];
    for (const width of colWidths) xPos.push(xPos[xPos.length - 1] + width * scale);
    const yPos = [0];
    for (const height of rowHeights) yPos.push(yPos[yPos.length - 1] + height * scale);
    const contentWidth = xPos[xPos.length - 1];
    const contentHeight = yPos[yPos.length - 1];
    const originX = margins.left + Math.max(0, (usableWidth - contentWidth) / 2);
    const originY = margins.top + Math.max(0, (usableHeight - contentHeight) / 2);

    const targetWidth = layout.orientation === "landscape" ? 560 : 420;
    const pixelScale = targetWidth / pageWidth;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pageWidth * pixelScale));
    canvas.height = Math.max(1, Math.round(pageHeight * pixelScale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(pixelScale, pixelScale);
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "middle";

    const drawnMerges = new Set();
    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowLocal = r - range.s.r;
      if (rowHeights[rowLocal] <= 0) continue;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const colLocal = c - range.s.c;
        if (colWidths[colLocal] <= 0) continue;
        const merge = xlsMergeForCell(layout, r, c);
        if (merge) {
          const key = `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`;
          if (drawnMerges.has(key)) continue;
          if (r !== merge.s.r || c !== merge.s.c) continue;
          drawnMerges.add(key);
        }

        const startR = merge ? merge.s.r : r;
        const endR = merge ? merge.e.r : r;
        const startC = merge ? merge.s.c : c;
        const endC = merge ? merge.e.c : c;
        const localR1 = startR - range.s.r;
        const localR2 = endR - range.s.r;
        const localC1 = startC - range.s.c;
        const localC2 = endC - range.s.c;
        const x = originX + xPos[localC1];
        const y = originY + yPos[localR1];
        const width = xPos[localC2 + 1] - xPos[localC1];
        const height = yPos[localR2 + 1] - yPos[localR1];
        if (width <= 0 || height <= 0) continue;

        const style = xlsStyleForCell(layout, startR, startC);
        const border = merge ? xlsLegacyMergedBorder(layout, merge) : style;
        if (border.left || border.right || border.top || border.bottom) {
          drawSpreadsheetPreviewBorder(ctx, x, y, width, height, border, scale);
        }

        const source = xlsCellSource(sheet, XLSX, startR, startC);
        if (!source.text) continue;
        let fontSize = Math.max(5.6, Math.min(12, (style.font?.size || 11) * scale));
        const weight = style.font?.bold ? 700 : 400;
        const padding = Math.max(1.5, 2.4 * scale);
        ctx.font = `${weight} ${fontSize}px Arial, Helvetica, sans-serif`;
        let textWidth = ctx.measureText(source.text).width;
        const maxTextWidth = Math.max(1, width - padding * 2);
        if (textWidth > maxTextWidth && !style.wrapText && (style.horizontal === 2 || style.horizontal === 3)) {
          while (fontSize > 5.2 && textWidth > maxTextWidth) {
            fontSize -= 0.25;
            ctx.font = `${weight} ${fontSize}px Arial, Helvetica, sans-serif`;
            textWidth = ctx.measureText(source.text).width;
          }
        }

        let textX = x + padding;
        if (style.horizontal === 2 || style.horizontal === 6) {
          textX = x + Math.max(padding, (width - textWidth) / 2);
        } else if (style.horizontal === 3 || source.cell?.t === "n") {
          textX = x + Math.max(padding, width - padding - textWidth);
        }
        ctx.fillText(source.text, textX, y + height / 2);
      }
    }

    for (const image of layout.images || []) {
      try {
        const fromCol = image.from.col - range.s.c;
        const toCol = image.to.col - range.s.c;
        const fromRow = image.from.row - range.s.r;
        const toRow = image.to.row - range.s.r;
        if (fromCol < 0 || toCol < 0 || fromRow < 0 || toRow < 0 ||
            fromCol >= colWidths.length || toCol >= colWidths.length ||
            fromRow >= rowHeights.length || toRow >= rowHeights.length) continue;
        const imageX = originX + xPos[fromCol] + colWidths[fromCol] * scale * image.from.colFrac;
        const imageTop = originY + yPos[fromRow] + rowHeights[fromRow] * scale * image.from.rowFrac;
        const imageRight = originX + xPos[toCol] + colWidths[toCol] * scale * image.to.colFrac;
        const imageBottom = originY + yPos[toRow] + rowHeights[toRow] * scale * image.to.rowFrac;
        const boxWidth = Math.max(1, imageRight - imageX);
        const boxHeight = Math.max(1, imageBottom - imageTop);
        const sourceImage = await loadSpreadsheetPreviewImage(image.data, image.extension);
        const naturalWidth = sourceImage.naturalWidth || sourceImage.width;
        const naturalHeight = sourceImage.naturalHeight || sourceImage.height;
        const imageScale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
        const drawWidth = naturalWidth * imageScale;
        const drawHeight = naturalHeight * imageScale;
        ctx.drawImage(
          sourceImage,
          imageX + (boxWidth - drawWidth) / 2,
          imageTop + (boxHeight - drawHeight) / 2,
          drawWidth,
          drawHeight
        );
      } catch {
        // A broken embedded image should never stop the spreadsheet thumbnail.
      }
    }

    ctx.restore();
    return canvas.toDataURL("image/png");
  }

  function renderSimpleSpreadsheetPreview(workbook, XLSX) {
    const sheetName = workbook?.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) return null;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
    if (!rows.length) return null;

    const columnCount = Math.max(1, ...rows.map(row => row.length));
    const shownRows = rows.slice(0, 38);
    const canvas = document.createElement("canvas");
    canvas.width = 560;
    canvas.height = 396;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const margin = 20;
    const titleHeight = 30;
    const gridWidth = canvas.width - margin * 2;
    const gridHeight = canvas.height - margin * 2 - titleHeight;
    const cellWidth = gridWidth / Math.max(1, columnCount);
    const rowHeight = gridHeight / Math.max(1, shownRows.length);
    ctx.strokeStyle = "#c8ceca";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#111714";
    ctx.font = "700 13px Arial, Helvetica, sans-serif";
    ctx.fillText(spreadsheetText(sheetName), margin, margin + 16);
    ctx.font = `${Math.max(7, Math.min(10, rowHeight * 0.55))}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "middle";

    for (let r = 0; r < shownRows.length; r++) {
      for (let c = 0; c < columnCount; c++) {
        const x = margin + c * cellWidth;
        const y = margin + titleHeight + r * rowHeight;
        ctx.strokeRect(x, y, cellWidth, rowHeight);
        const value = spreadsheetText(shownRows[r]?.[c] ?? "");
        if (value) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 2, y + 1, Math.max(1, cellWidth - 4), Math.max(1, rowHeight - 2));
          ctx.clip();
          ctx.fillText(value, x + 3, y + rowHeight / 2);
          ctx.restore();
        }
      }
    }
    return canvas.toDataURL("image/png");
  }

  async function prepareSpreadsheetPreview(item) {
    if (!isSpreadsheetKind(item?.kind)) return;
    try {
      const XLSX = await loadXlsxEngine();
      const bytes = await item.file.arrayBuffer();
      const workbook = XLSX.read(bytes, {
        type: "array",
        cellDates: true,
        cellStyles: true,
        sheetStubs: true
      });
      let preview = null;
      if (item.kind === "xls") {
        try {
          const layouts = parseLegacyXlsLayout(new Uint8Array(bytes));
          preview = await renderLegacyXlsSpreadsheetPreview(workbook, XLSX, layouts);
        } catch (error) {
          console.warn("Legacy Excel thumbnail fallback:", error);
        }
      }
      if (!preview) preview = renderSimpleSpreadsheetPreview(workbook, XLSX);
      item.spreadsheetPreview = preview;
    } catch (error) {
      console.warn("Spreadsheet preview failed:", error);
      item.spreadsheetPreview = null;
    }
  }

  async function addLegacyXlsSpreadsheetPages(target, workbook, XLSX, layouts) {
    if (!layouts?.size) return false;
    const regular = await target.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await target.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const portrait = [595.28, 841.89];
    const landscape = [841.89, 595.28];
    let pagesAdded = 0;

    for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex++) {
      const sheetName = workbook.SheetNames[sheetIndex];
      const sheet = workbook.Sheets[sheetName];
      const layout = layouts.get(sheetName) || Array.from(layouts.values())[sheetIndex];
      if (!sheet || !layout?.legacy) continue;

      const range = {
        s: { r: layout.range.s.r, c: layout.range.s.c },
        e: { r: layout.range.e.r, c: layout.range.e.c }
      };
      const colWidths = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const meta = layout.cols.get(c);
        colWidths.push(meta?.hidden ? 0 : Math.max(2, meta?.width || 48));
      }
      const rowHeights = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const meta = layout.rows.get(r);
        rowHeights.push(meta?.hidden ? 0 : Math.max(2, meta?.height || 15));
      }

      const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);
      const totalHeight = rowHeights.reduce((sum, value) => sum + value, 0);
      if (!totalWidth || !totalHeight) continue;

      const pageSize = layout.orientation === "landscape" ? landscape : portrait;
      const [pageWidth, pageHeight] = pageSize;
      const margins = xlsLegacyMargins(layout);
      const usableWidth = pageWidth - margins.left - margins.right;
      const usableHeight = pageHeight - margins.top - margins.bottom;
      const scale = Math.min(
        1,
        usableWidth / Math.max(1, totalWidth),
        usableHeight / Math.max(1, totalHeight)
      );
      const xPos = [0];
      for (const width of colWidths) xPos.push(xPos[xPos.length - 1] + width * scale);
      const yPos = [0];
      for (const height of rowHeights) yPos.push(yPos[yPos.length - 1] + height * scale);
      const contentWidth = xPos[xPos.length - 1];
      const contentHeight = yPos[yPos.length - 1];
      const originX = margins.left + Math.max(0, (usableWidth - contentWidth) / 2);
      const topY = pageHeight - margins.top - Math.max(0, (usableHeight - contentHeight) / 2);
      const page = target.addPage(pageSize);
      pagesAdded++;
      const drawnMerges = new Set();

      for (let r = range.s.r; r <= range.e.r; r++) {
        const rowLocal = r - range.s.r;
        if (rowHeights[rowLocal] <= 0) continue;
        for (let c = range.s.c; c <= range.e.c; c++) {
          const colLocal = c - range.s.c;
          if (colWidths[colLocal] <= 0) continue;
          const merge = xlsMergeForCell(layout, r, c);
          if (merge) {
            const key = `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`;
            if (drawnMerges.has(key)) continue;
            if (r !== merge.s.r || c !== merge.s.c) continue;
            drawnMerges.add(key);
          }

          const startR = merge ? merge.s.r : r;
          const endR = merge ? merge.e.r : r;
          const startC = merge ? merge.s.c : c;
          const endC = merge ? merge.e.c : c;
          const localR1 = startR - range.s.r;
          const localR2 = endR - range.s.r;
          const localC1 = startC - range.s.c;
          const localC2 = endC - range.s.c;
          const x = originX + xPos[localC1];
          const width = xPos[localC2 + 1] - xPos[localC1];
          const yTop = topY - yPos[localR1];
          const yBottom = topY - yPos[localR2 + 1];
          const height = yTop - yBottom;
          if (width <= 0 || height <= 0) continue;

          const style = xlsStyleForCell(layout, startR, startC);
          const border = merge ? xlsLegacyMergedBorder(layout, merge) : style;
          if (border.left || border.right || border.top || border.bottom) {
            xlsDrawBorder(page, x, yBottom, width, height, border, scale);
          }

          const source = xlsCellSource(sheet, XLSX, startR, startC);
          if (!source.text) continue;
          const selectedFont = style.font?.bold ? bold : regular;
          let fontSize = Math.max(5.6, Math.min(12, (style.font?.size || 11) * scale));
          const padding = Math.max(1.5, 2.4 * scale);
          let textBoxWidth = width;
          if (!merge && style.horizontal !== 2 && style.horizontal !== 3) {
            textBoxWidth = Math.max(width, xlsLegacyTextWidth(layout, sheet, XLSX, r, c, range, xPos, originX));
          }
          const maxTextWidth = Math.max(1, textBoxWidth - padding * 2);
          let text = source.text;
          let textWidth = selectedFont.widthOfTextAtSize(text, fontSize);

          if (textWidth > maxTextWidth && !style.wrapText) {
            while (fontSize > 5.2 && textWidth > maxTextWidth) {
              fontSize -= 0.25;
              textWidth = selectedFont.widthOfTextAtSize(text, fontSize);
            }
          }

          const horizontal = style.horizontal;
          let textX = x + padding;
          if (horizontal === 2 || horizontal === 6) {
            textX = x + Math.max(padding, (width - textWidth) / 2);
          } else if (horizontal === 3 || source.cell?.t === "n") {
            textX = x + Math.max(padding, width - padding - textWidth);
          }
          const textY = yBottom + Math.max(1.5, (height - fontSize) / 2 + 0.6);
          page.drawText(text, {
            x: textX,
            y: textY,
            size: fontSize,
            font: selectedFont,
            color: PDFLib.rgb(0.04, 0.04, 0.04)
          });
        }
      }

      for (const image of layout.images || []) {
        try {
          const embedded = image.extension === "png"
            ? await target.embedPng(image.data)
            : await target.embedJpg(image.data);
          const fromCol = image.from.col - range.s.c;
          const toCol = image.to.col - range.s.c;
          const fromRow = image.from.row - range.s.r;
          const toRow = image.to.row - range.s.r;
          if (fromCol < 0 || toCol < 0 || fromRow < 0 || toRow < 0 ||
              fromCol >= colWidths.length || toCol >= colWidths.length ||
              fromRow >= rowHeights.length || toRow >= rowHeights.length) continue;
          const imageX = originX + xPos[fromCol] + colWidths[fromCol] * scale * image.from.colFrac;
          const imageTop = topY - yPos[fromRow] - rowHeights[fromRow] * scale * image.from.rowFrac;
          const imageRight = originX + xPos[toCol] + colWidths[toCol] * scale * image.to.colFrac;
          const imageBottom = topY - yPos[toRow] - rowHeights[toRow] * scale * image.to.rowFrac;
          const boxWidth = Math.max(1, imageRight - imageX);
          const boxHeight = Math.max(1, imageTop - imageBottom);
          const natural = embedded.scale(1);
          const imageScale = Math.min(boxWidth / natural.width, boxHeight / natural.height);
          const drawWidth = natural.width * imageScale;
          const drawHeight = natural.height * imageScale;
          page.drawImage(embedded, {
            x: imageX + (boxWidth - drawWidth) / 2,
            y: imageBottom + (boxHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight
          });
        } catch {
          // Ignore unsupported legacy worksheet artwork and keep the document usable.
        }
      }
    }

    return pagesAdded > 0;
  }


  async function addSpreadsheetPages(target, item) {
    const XLSX = await loadXlsxEngine();
    const bytes = await item.file.arrayBuffer();
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellStyles: true,
      sheetStubs: true
    });

    if (item.kind === "xls") {
      try {
        const legacyLayouts = parseLegacyXlsLayout(new Uint8Array(bytes));
        if (await addLegacyXlsSpreadsheetPages(target, workbook, XLSX, legacyLayouts)) return;
      } catch {
        // Fall back to the simple Excel renderer for unusual or damaged legacy files.
      }
    }

    const font = await target.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await target.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const a4Landscape = [841.89, 595.28];
    const margin = 28;
    const titleHeight = 30;
    const cellPadding = 3;
    const usableWidth = a4Landscape[0] - margin * 2;
    const usableHeight = a4Landscape[1] - margin * 2 - titleHeight;
    const sheetNames = workbook.SheetNames.length ? workbook.SheetNames : ["Sheet1"];

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const sourceRows = sheet
        ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false })
        : [];
      const rows = sourceRows.length ? sourceRows : [[""]];
      const columnCount = Math.max(1, ...rows.map(row => row.length));

      // Keep ordinary worksheets together horizontally. The earlier simple
      // converter split sheets after eight columns, which could turn a normal
      // one-page Excel printout into several PDF pages. Instead, fit all used
      // columns across one landscape A4 page and only paginate vertically when
      // a genuinely long worksheet cannot remain readable on one page.
      const cellWidth = usableWidth / columnCount;
      const fitWholeSheet = rows.length <= 50 && columnCount <= 16;
      const rowHeight = fitWholeSheet
        ? Math.max(9, Math.min(20, usableHeight / Math.max(1, rows.length)))
        : 18;
      const rowsPerPage = fitWholeSheet
        ? rows.length
        : Math.max(1, Math.floor(usableHeight / rowHeight));
      const fontSize = Math.max(5.5, Math.min(8, rowHeight * 0.42, cellWidth / 6.5));

      for (let rowStart = 0; rowStart < rows.length; rowStart += rowsPerPage) {
        const page = target.addPage(a4Landscape);
        const [, pageHeight] = a4Landscape;
        const sheetLabel = spreadsheetText(sheetName) || "Worksheet";

        page.drawText(sheetLabel, {
          x: margin,
          y: pageHeight - margin - 12,
          size: 11,
          font: bold
        });

        const pageRows = rows.slice(rowStart, rowStart + rowsPerPage);
        pageRows.forEach((row, rowOffset) => {
          const yTop = pageHeight - margin - titleHeight - rowOffset * rowHeight;
          const yBottom = yTop - rowHeight;

          for (let c = 0; c < columnCount; c++) {
            const x = margin + c * cellWidth;
            const value = row[c] ?? "";

            page.drawRectangle({
              x,
              y: yBottom,
              width: cellWidth,
              height: rowHeight,
              borderWidth: 0.5,
              borderColor: PDFLib.rgb(0.82, 0.82, 0.82)
            });

            const fitted = fitSpreadsheetText(
              value,
              font,
              fontSize,
              Math.max(0, cellWidth - cellPadding * 2)
            );
            if (fitted) {
              page.drawText(fitted, {
                x: x + cellPadding,
                y: yBottom + Math.max(2.5, (rowHeight - fontSize) / 2),
                size: fontSize,
                font
              });
            }
          }
        });
      }
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
        } else if (item.kind === "docx") {
          await addDocxPages(output, item);
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
      } else if (text.includes("DOCX_ENGINE_UNAVAILABLE")) {
        message = "Word document support could not load. Check your connection and try again.";
      } else if (text.includes("DOCX_RENDER_EMPTY") || text.includes("DOCX_IMAGE_FAILED")) {
        message = "That Word document could not be rendered. Try saving it again as a DOCX file.";
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
