PDFIT v1 — GITHUB-READY TEST BUILD
===================================

PRODUCT
-------
PDFs + images + mobile camera photos -> arrange -> create one PDF -> download.

SUPPORTED INPUT
---------------
PDF
JPG / JPEG
PNG
WEBP
Camera photo (mobile/browser dependent)

PRIVACY
-------
All document processing happens in the browser. Files are not uploaded to a PDFit server.

IMPORTANT
---------
1. The package already assumes the future final domain is:
   https://pdfit.co.za/

2. You can test it on GitHub Pages before connecting the domain on your batch launch day.

3. Google Analytics is intentionally not included yet.
   Add PDFit's own GA4 measurement tag only when the final domain is connected.

4. Existing PDFs are merged as PDF pages rather than rasterized.

5. Images are fitted onto A4-style portrait/landscape pages.

6. Mobile camera:
   The Take photo control uses an HTML camera-capture file input.
   On compatible phones it should open or offer the rear camera.
   Browser/OS behavior can vary, so normal image selection remains the fallback.

7. This is NOT yet the advanced PDFit Scan product.
   Camera photos are currently treated as normal image pages.
   Automatic crop / edge detection / perspective correction / brightening can be added later.

8. Reordering:
   - Desktop: drag and drop.
   - Mobile: left/right arrows are included because touch drag behavior varies by browser.

9. Practical limits:
   - Single file guard: 150 MB.
   - Approximate total input guard: 500 MB.
   - Actual success still depends on device memory.

10. Before permanent launch:
    - Test Chrome / Edge / Firefox / Safari.
    - Test Android camera capture.
    - Test iPhone/iPad camera capture if possible.
    - Test PDF-only, image-only, mixed PDF+image, and password-protected PDF cases.
    - Connect pdfit.co.za and verify HTTPS.
    - Add GA4.
    - Configure Google Search Console and Bing Webmaster Tools.
    - Submit sitemap.
    - Run PageSpeed / Rich Results / site scan.


V2 SMART DOCUMENT CAMERA
------------------------
The Take photo path now tries to open PDFit's own camera interface using getUserMedia.

When supported:
- Rear camera opens inside PDFit.
- OpenCV.js analyses live frames.
- A green quadrilateral outlines a detected page.
- Capture uses the detected corners for perspective correction.
- The corrected page receives scanner-style cleanup before being added.
- If no page is detected, the shutter still captures a normal image.
- "Use phone camera" remains as a fallback to the device's ordinary camera picker.

IMPORTANT:
This is a browser-based scanner beta. Edge detection is heuristic and should be tested on multiple Android and iOS devices, in varied lighting and against different backgrounds.


CACHE-BUSTING
-------------
This build references:
- styles.css?v=2.0.1
- app.js?v=2.0.1

When making a new deployment, increment the version string in index.html.
This helps phones fetch the latest CSS/JS without clearing all browser data.


V2.0.2 SCANNER POLISH
---------------------
- Gentler document cleanup to preserve faint detail and handwriting.
- 1.8% clean white safety margin added around perspective-corrected scans.
- Scanner output now attempts to match the phone's current portrait/landscape orientation.
- Existing Rotate control remains available as a manual fallback.
- Cache-busting updated to app.js?v=2.0.2 and styles.css?v=2.0.2.


V2.0.3 ADAPTIVE ILLUMINATION
----------------------------
- Adds local/adaptive illumination correction for shadows and uneven lighting.
- Keeps the gentler v2.0.2 cleanup profile.
- Preserves the existing crop, white safety margin, orientation logic and UI.
- Cache-busting updated to app.js?v=2.0.3 and styles.css?v=2.0.3.


V2.0.4 UI POLISH
----------------
Presentation-only refinement:
- Cleaner scan thumbnail presentation.
- Better spacing and typography in file cards.
- More polished mobile button layout.
- Slightly stronger primary-action hierarchy.
- No changes to document detection, crop, illumination correction or PDF generation.
- Cache-busting updated to app.js?v=2.0.4 and styles.css?v=2.0.4.
