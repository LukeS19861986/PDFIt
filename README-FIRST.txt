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
