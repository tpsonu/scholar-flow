/**
 * OmniStudy Passport Photo Resizer & KB Precision Compressor
 * Adjusts exact pixel dimensions (width x height) AND file size in KB.
 */

import { storeBlob, getBlob } from './storage.js';

let currentImage = null;
let originalPhotoMeta = null;
let processedBlob = null;
let processedDataUrl = null;

export let currentUnit = 'px'; // 'px' | 'cm' | 'in'

export function getDPI() {
  const dpiInput = document.getElementById('passport-dpi-input');
  const val = parseInt(dpiInput?.value || 300, 10);
  return (Number.isFinite(val) && val > 0) ? Math.max(50, Math.min(2400, val)) : 300;
}

export function getTargetPixelDimensions() {
  const widthInput = document.getElementById('passport-width-input');
  const heightInput = document.getElementById('passport-height-input');
  const fallbackW = originalPhotoMeta ? originalPhotoMeta.width : 413;
  const fallbackH = originalPhotoMeta ? originalPhotoMeta.height : 531;
  const wVal = parseFloat(widthInput?.value || fallbackW) || fallbackW;
  const hVal = parseFloat(heightInput?.value || fallbackH) || fallbackH;
  const dpi = getDPI();

  if (currentUnit === 'cm') {
    // 1 inch = 2.54 cm -> pixels = (cm / 2.54) * DPI
    const pxW = Math.round((wVal / 2.54) * dpi);
    const pxH = Math.round((hVal / 2.54) * dpi);
    return { width: Math.max(10, pxW), height: Math.max(10, pxH) };
  } else if (currentUnit === 'in') {
    // pixels = inches * DPI
    const pxW = Math.round(wVal * dpi);
    const pxH = Math.round(hVal * dpi);
    return { width: Math.max(10, pxW), height: Math.max(10, pxH) };
  } else {
    return { width: Math.max(10, Math.round(wVal)), height: Math.max(10, Math.round(hVal)) };
  }
}

/**
 * Detect embedded DPI from JPEG APP0 (JFIF) or PNG (pHYs) headers
 */
export function detectImageDpi(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    const len = view.byteLength;

    // Check JPEG SOI (0xFFD8)
    if (len > 4 && view.getUint16(0) === 0xFFD8) {
      let offset = 2;
      while (offset < len - 4) {
        const marker = view.getUint16(offset);
        if (marker === 0xFFE0) { // APP0 JFIF
          const app0Len = view.getUint16(offset + 2);
          const isJfif = 
            view.getUint8(offset + 4) === 0x4A && // J
            view.getUint8(offset + 5) === 0x46 && // F
            view.getUint8(offset + 6) === 0x49 && // I
            view.getUint8(offset + 7) === 0x46 && // F
            view.getUint8(offset + 8) === 0x00;
          if (isJfif && app0Len >= 16) {
            const units = view.getUint8(offset + 11);
            const xDensity = view.getUint16(offset + 12, false);
            if (units === 1 && xDensity >= 50) return xDensity; // DPI
            if (units === 2 && xDensity >= 20) return Math.round(xDensity * 2.54); // Dots per cm -> DPI
          }
        } else if (marker === 0xFFDA) {
          break; // Start of Scan
        }
        const segLen = view.getUint16(offset + 2);
        offset += 2 + segLen;
      }
    }

    // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (len > 30 && view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
      let offset = 8;
      while (offset < len - 8) {
        const chunkLen = view.getUint32(offset);
        const chunkType = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );
        if (chunkType === 'pHYs' && chunkLen >= 9) {
          const ppuX = view.getUint32(offset + 8);
          const unit = view.getUint8(offset + 16);
          if (unit === 1 && ppuX > 0) {
            const dpi = Math.round(ppuX * 0.0254);
            if (dpi >= 50) return dpi;
          }
        }
        if (chunkType === 'IEND') break;
        offset += 12 + chunkLen;
      }
    }
  } catch (err) {
    console.warn('Could not read image DPI metadata:', err);
  }
  return 300; // standard default
}

/**
 * Enable or disable precision controls based on photo loaded state
 */
export function setControlsEnabled(enabled) {
  const elements = [
    'passport-unit-select',
    'passport-dpi-input',
    'passport-width-input',
    'passport-height-input',
    'passport-kb-input',
    'passport-zoom-slider',
    'passport-offset-x',
    'passport-offset-y',
    'passport-process-download-btn'
  ];

  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });

  const controlsCard = document.getElementById('passport-controls-card');
  if (controlsCard) {
    if (enabled) {
      controlsCard.classList.remove('controls-disabled');
    } else {
      controlsCard.classList.add('controls-disabled');
    }
  }

  const promptBanner = document.getElementById('passport-upload-prompt');
  const detectedBanner = document.getElementById('passport-detected-banner');
  if (promptBanner) promptBanner.style.display = enabled ? 'none' : 'flex';
  if (detectedBanner) detectedBanner.style.display = enabled ? 'flex' : 'none';

  if (enabled && originalPhotoMeta) {
    const infoText = document.getElementById('passport-detected-info');
    const kb = (originalPhotoMeta.size / 1024).toFixed(1);
    if (infoText) {
      infoText.textContent = `${originalPhotoMeta.width} × ${originalPhotoMeta.height} px (${kb} KB, ${originalPhotoMeta.dpi} DPI)`;
    }
  }
}

/**
 * Apply detected original photo values into the inputs
 */
export function applyOriginalPhotoValues() {
  if (!originalPhotoMeta) return;

  const unitSelect = document.getElementById('passport-unit-select');
  const dpiInput = document.getElementById('passport-dpi-input');
  const widthInput = document.getElementById('passport-width-input');
  const heightInput = document.getElementById('passport-height-input');
  const kbInput = document.getElementById('passport-kb-input');
  const zoomSlider = document.getElementById('passport-zoom-slider');
  const offsetXSlider = document.getElementById('passport-offset-x');
  const offsetYSlider = document.getElementById('passport-offset-y');

  // Default to px unit to show true original pixel dimensions immediately
  currentUnit = 'px';
  if (unitSelect) unitSelect.value = 'px';
  const unitLabelW = document.getElementById('passport-unit-label-w');
  const unitLabelH = document.getElementById('passport-unit-label-h');
  if (unitLabelW) unitLabelW.textContent = 'px';
  if (unitLabelH) unitLabelH.textContent = 'px';
  const equivBox = document.getElementById('passport-pixel-equiv');
  if (equivBox) equivBox.style.display = 'none';

  if (dpiInput) dpiInput.value = originalPhotoMeta.dpi;
  if (widthInput) {
    widthInput.value = originalPhotoMeta.width;
    widthInput.step = '1';
  }
  if (heightInput) {
    heightInput.value = originalPhotoMeta.height;
    heightInput.step = '1';
  }
  if (kbInput) kbInput.value = Math.max(1, Math.ceil(originalPhotoMeta.size / 1024));

  if (zoomSlider) zoomSlider.value = 1;
  if (offsetXSlider) offsetXSlider.value = 0;
  if (offsetYSlider) offsetYSlider.value = 0;

  updatePixelEquivText();
}

function handleUnitChange(newUnit) {
  if (newUnit === currentUnit) return;
  const widthInput = document.getElementById('passport-width-input');
  const heightInput = document.getElementById('passport-height-input');
  const unitLabelW = document.getElementById('passport-unit-label-w');
  const unitLabelH = document.getElementById('passport-unit-label-h');
  const equivBox = document.getElementById('passport-pixel-equiv');
  const dpi = getDPI();

  const { width: currentPxW, height: currentPxH } = getTargetPixelDimensions();
  currentUnit = newUnit;

  if (unitLabelW) unitLabelW.textContent = newUnit;
  if (unitLabelH) unitLabelH.textContent = newUnit;

  if (newUnit === 'cm') {
    if (widthInput) {
      widthInput.value = ((currentPxW / dpi) * 2.54).toFixed(1);
      widthInput.step = '0.1';
    }
    if (heightInput) {
      heightInput.value = ((currentPxH / dpi) * 2.54).toFixed(1);
      heightInput.step = '0.1';
    }
    if (equivBox) equivBox.style.display = 'block';
  } else if (newUnit === 'in') {
    if (widthInput) {
      widthInput.value = (currentPxW / dpi).toFixed(2);
      widthInput.step = '0.05';
    }
    if (heightInput) {
      heightInput.value = (currentPxH / dpi).toFixed(2);
      heightInput.step = '0.05';
    }
    if (equivBox) equivBox.style.display = 'block';
  } else {
    if (widthInput) {
      widthInput.value = currentPxW;
      widthInput.step = '1';
    }
    if (heightInput) {
      heightInput.value = currentPxH;
      heightInput.step = '1';
    }
    if (equivBox) equivBox.style.display = 'none';
  }

  updatePixelEquivText();
  renderLiveCanvas();
}

function updatePixelEquivText() {
  const { width, height } = getTargetPixelDimensions();
  const textElem = document.getElementById('passport-pixel-equiv-text');
  if (textElem) {
    textElem.textContent = `${width} × ${height} px`;
  }
}

export function initPassportModule(onStateChange) {
  const fileInput = document.getElementById('passport-file-input');
  const unitSelect = document.getElementById('passport-unit-select');
  const dpiInput = document.getElementById('passport-dpi-input');
  const widthInput = document.getElementById('passport-width-input');
  const heightInput = document.getElementById('passport-height-input');
  const kbInput = document.getElementById('passport-kb-input');
  const zoomSlider = document.getElementById('passport-zoom-slider');
  const offsetXSlider = document.getElementById('passport-offset-x');
  const offsetYSlider = document.getElementById('passport-offset-y');
  const processDownloadBtn = document.getElementById('passport-process-download-btn');
  const dropzone = document.getElementById('passport-dropzone');
  const resetOrigBtn = document.getElementById('passport-reset-orig-btn');

  // Controls start disabled until photo is uploaded
  setControlsEnabled(false);

  // Handle unit change (px / cm / in)
  unitSelect?.addEventListener('change', () => {
    handleUnitChange(unitSelect.value);
    if (onStateChange) onStateChange();
  });

  // Handle DPI change
  dpiInput?.addEventListener('input', () => {
    updatePixelEquivText();
    renderLiveCanvas();
    if (onStateChange) onStateChange();
  });

  // Handle inputs change
  [widthInput, heightInput, kbInput, zoomSlider, offsetXSlider, offsetYSlider].forEach(elem => {
    elem?.addEventListener('input', () => {
      updatePixelEquivText();
      renderLiveCanvas();
      if (onStateChange) onStateChange();
    });
  });

  // Reset to original photo values button
  resetOrigBtn?.addEventListener('click', () => {
    if (originalPhotoMeta) {
      applyOriginalPhotoValues();
      renderLiveCanvas();
      if (onStateChange) onStateChange();
    }
  });

  // Responsive display sizing on container resize
  if (typeof ResizeObserver !== 'undefined' && dropzone) {
    let resizeTimer;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderLiveCanvas();
      }, 50);
    });
    ro.observe(dropzone);
  } else {
    window.addEventListener('resize', () => renderLiveCanvas());
  }

  // Initial render
  updatePixelEquivText();
  renderLiveCanvas();

  // File Upload Handling
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file, onStateChange);
  });

  // Drag and drop handling
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--primary)';
  });
  dropzone?.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border)';
  });
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border)';
    if (e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0], onStateChange);
    }
  });

  // Process & Download button (single unified button)
  processDownloadBtn?.addEventListener('click', async () => {
    await processAndDownloadPhoto();
    if (onStateChange) onStateChange();
  });

  // Delete / Clear Photo button
  const deleteBtn = document.getElementById('passport-delete-btn');
  deleteBtn?.addEventListener('click', () => {
    currentImage = null;
    originalPhotoMeta = null;
    processedBlob = null;
    processedDataUrl = null;
    storeBlob('passport_current_photo', null);
    storeBlob('passport_processed_photo', null);
    if (fileInput) fileInput.value = '';
    const origStats = document.getElementById('passport-orig-stats');
    if (origStats) origStats.textContent = 'No photo loaded';
    const resultStats = document.getElementById('passport-output-stats');
    if (resultStats) resultStats.textContent = 'Target Output: Ready';
    const statusElem = document.getElementById('passport-process-status');
    if (statusElem) statusElem.textContent = '';

    setControlsEnabled(false);
    renderLiveCanvas();
    if (onStateChange) onStateChange();
  });

  // Try restoring existing photo if saved in IndexedDB
  getBlob('passport_current_photo').then((blob) => {
    if (blob) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const arrayBuf = await blob.arrayBuffer();
        const detectedDpi = detectImageDpi(arrayBuf);
        const img = new Image();
        img.onload = () => {
          currentImage = img;
          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;
          originalPhotoMeta = {
            width: origW,
            height: origH,
            size: blob.size,
            dpi: detectedDpi || 300,
            name: 'photo.jpg'
          };
          applyOriginalPhotoValues();
          setControlsEnabled(true);
          updateOriginalStats(blob.size, origW, origH, originalPhotoMeta.dpi);
          renderLiveCanvas();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
    }
  });
}

async function handleImageFile(file, onStateChange) {
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (JPG, PNG, WEBP).');
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  const detectedDpi = detectImageDpi(arrayBuffer);

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      originalPhotoMeta = {
        width: origW,
        height: origH,
        size: file.size,
        dpi: detectedDpi || 300,
        name: file.name
      };

      // Set input values to the detected original values
      applyOriginalPhotoValues();

      // Enable precision controls now that image is detected
      setControlsEnabled(true);

      updateOriginalStats(file.size, origW, origH, originalPhotoMeta.dpi);
      renderLiveCanvas();
      storeBlob('passport_current_photo', file, originalPhotoMeta);
      if (onStateChange) onStateChange();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateOriginalStats(bytes, width, height, dpi) {
  const kb = (bytes / 1024).toFixed(1);
  const origStats = document.getElementById('passport-orig-stats');
  if (origStats) {
    const dpiText = dpi ? ` @ ${dpi} DPI` : '';
    origStats.textContent = `Original: ${width} × ${height} px${dpiText} (${kb} KB)`;
  }
}

export function updateCanvasDisplaySize(canvas, targetWidth, targetHeight) {
  const dropzone = document.getElementById('passport-dropzone');
  if (!canvas) return;

  const pad = 36;
  const availW = Math.max(120, ((dropzone?.clientWidth || 400) - pad));
  const availH = Math.max(120, ((dropzone?.clientHeight || 440) - pad));
  const aspect = targetWidth / targetHeight;

  let dispW, dispH;
  if (availW / availH > aspect) {
    dispH = availH;
    dispW = Math.round(dispH * aspect);
  } else {
    dispW = availW;
    dispH = Math.round(dispW / aspect);
  }

  dispW = Math.max(120, dispW);
  dispH = Math.max(120, dispH);

  canvas.style.width = `${dispW}px`;
  canvas.style.height = `${dispW ? dispH : 400}px`;
}

/**
 * Render image onto interactive preview canvas with full original quality (Retina resolution buffer)
 */
export function renderLiveCanvas() {
  const canvas = document.getElementById('passport-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width: targetWidth, height: targetHeight } = getTargetPixelDimensions();
  const zoom = parseFloat(document.getElementById('passport-zoom-slider')?.value || 1);
  const offsetX = parseFloat(document.getElementById('passport-offset-x')?.value || 0);
  const offsetY = parseFloat(document.getElementById('passport-offset-y')?.value || 0);

  // Dynamically size display canvas element to comfortably fill the container at normal viewable size
  updateCanvasDisplaySize(canvas, targetWidth, targetHeight);

  if (currentImage) {
    // PREVIEW CANVAS RESOLUTION:
    // Render at crisp Retina display resolution to maintain 100% original visual fidelity without downsampling
    const dpr = Math.max(2, window.devicePixelRatio || 2);
    const dispW = parseFloat(canvas.style.width) || 360;
    const dispH = parseFloat(canvas.style.height) || 400;

    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Background Fill
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Compute scale to cover target canvas buffer
    const imgW = currentImage.naturalWidth || currentImage.width;
    const imgH = currentImage.naturalHeight || currentImage.height;
    const imgAspect = imgW / imgH;
    const canvasAspect = canvas.width / canvas.height;

    let drawW, drawH;
    if (imgAspect > canvasAspect) {
      drawH = canvas.height * zoom;
      drawW = drawH * imgAspect;
    } else {
      drawW = canvas.width * zoom;
      drawH = drawW / imgAspect;
    }

    const drawX = (canvas.width - drawW) / 2 + (offsetX * canvas.width / 100);
    const drawY = (canvas.height - drawH) / 2 + (offsetY * canvas.height / 100);

    ctx.drawImage(currentImage, drawX, drawY, drawW, drawH);
    ctx.restore();
  } else {
    // Scalable placeholder state when no image is loaded
    const scale = Math.max(1, Math.ceil(500 / Math.max(targetWidth, targetHeight)));
    canvas.width = targetWidth * scale;
    canvas.height = targetHeight * scale;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const baseDim = Math.min(canvas.width, canvas.height);
    const fontSize = Math.max(12, Math.min(24, Math.round(baseDim * 0.055)));
    const subFontSize = Math.max(10, Math.min(16, Math.round(baseDim * 0.036)));
    const iconSize = Math.max(24, Math.min(52, Math.round(baseDim * 0.12)));

    // Subtle dashed guideline inset border
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(1, Math.round(baseDim * 0.005));
    ctx.setLineDash([6, 6]);
    const inset = Math.max(8, Math.round(baseDim * 0.035));
    ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
    ctx.setLineDash([]);

    // Icon
    ctx.font = `${iconSize}px system-ui, "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷', canvas.width / 2, canvas.height / 2 - iconSize * 0.75);

    // Primary text
    ctx.fillStyle = '#334155';
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('Upload Photo to Preview', canvas.width / 2, canvas.height / 2 + iconSize * 0.15);

    // Secondary text
    ctx.fillStyle = '#64748b';
    ctx.font = `${subFontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('Drag & drop or choose from device', canvas.width / 2, canvas.height / 2 + iconSize * 0.15 + fontSize * 1.5);
  }
}

/**
 * Precision Compression Algorithm & Automatic Downloader
 * Exports to exact target pixel dimensions, compresses to target KB, embeds DPI, and immediately triggers download!
 */
export async function processAndDownloadPhoto() {
  if (!currentImage) {
    alert('Please upload a photo first!');
    return;
  }

  const btn = document.getElementById('passport-process-download-btn');
  const originalBtnText = btn ? btn.innerHTML : '⚡ Process & Download';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Processing & Compressing...';
  }

  const statusElem = document.getElementById('passport-process-status');
  if (statusElem) {
    statusElem.textContent = 'Compressing to target size & generating download...';
    statusElem.style.color = 'var(--accent)';
  }

  try {
    const { width: targetWidth, height: targetHeight } = getTargetPixelDimensions();
    const targetKb = parseFloat(document.getElementById('passport-kb-input')?.value || 50);
    const targetBytes = targetKb * 1024;
    const zoom = parseFloat(document.getElementById('passport-zoom-slider')?.value || 1);
    const offsetX = parseFloat(document.getElementById('passport-offset-x')?.value || 0);
    const offsetY = parseFloat(document.getElementById('passport-offset-y')?.value || 0);

    // Render to exact target pixel dimensions onto offscreen export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;
    const expCtx = exportCanvas.getContext('2d');
    expCtx.imageSmoothingEnabled = true;
    expCtx.imageSmoothingQuality = 'high';

    expCtx.fillStyle = '#ffffff';
    expCtx.fillRect(0, 0, targetWidth, targetHeight);

    const imgW = currentImage.naturalWidth || currentImage.width;
    const imgH = currentImage.naturalHeight || currentImage.height;
    const imgAspect = imgW / imgH;
    const canvasAspect = targetWidth / targetHeight;

    let drawW, drawH;
    if (imgAspect > canvasAspect) {
      drawH = targetHeight * zoom;
      drawW = drawH * imgAspect;
    } else {
      drawW = targetWidth * zoom;
      drawH = drawW / imgAspect;
    }

    const drawX = (targetWidth - drawW) / 2 + (offsetX * targetWidth / 100);
    const drawY = (targetHeight - drawH) / 2 + (offsetY * targetHeight / 100);

    expCtx.drawImage(currentImage, drawX, drawY, drawW, drawH);

    // Binary search for optimal JPEG quality (0.01 to 1.0)
    let low = 0.05;
    let high = 0.98;
    let bestBlob = null;
    let bestDiff = Infinity;

    for (let iter = 0; iter < 10; iter++) {
      const midQuality = (low + high) / 2;
      const blob = await new Promise((res) => exportCanvas.toBlob(res, 'image/jpeg', midQuality));
      if (!blob) break;

      const diff = Math.abs(blob.size - targetBytes);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBlob = blob;
      }

      if (blob.size > targetBytes) {
        high = midQuality; // file too big, decrease quality
      } else {
        low = midQuality; // file too small or under limit, try higher quality
      }
    }

    // If even lowest quality exceeds targetBytes, perform slight downsampling or high compression
    if (bestBlob && bestBlob.size > targetBytes * 1.1) {
      bestBlob = await new Promise((res) => exportCanvas.toBlob(res, 'image/jpeg', 0.1));
    }

    if (bestBlob) {
      const dpi = getDPI();
      bestBlob = await setJpegDpi(bestBlob, dpi);
    }

    processedBlob = bestBlob;
    if (processedBlob) {
      const dpi = getDPI();
      const outKb = (processedBlob.size / 1024).toFixed(1);

      const resultStats = document.getElementById('passport-output-stats');
      if (resultStats) {
        resultStats.textContent = `Output: ${targetWidth} × ${targetHeight} px @ ${dpi} DPI (${outKb} KB)`;
      }

      if (statusElem) {
        statusElem.textContent = `✓ Download complete: ${targetWidth} × ${targetHeight} px at ${dpi} DPI, ${outKb} KB (Target: ${targetKb} KB)`;
        statusElem.style.color = 'var(--success)';
      }

      // Automatically trigger file download
      const filenameBase = originalPhotoMeta?.name ? originalPhotoMeta.name.replace(/\.[^/.]+$/, '') : 'photo';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(processedBlob);
      link.download = `${filenameBase}_${targetWidth}x${targetHeight}_${Math.round(outKb)}KB.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);

      // Save processed blob in IndexedDB
      storeBlob('passport_processed_photo', processedBlob, { width: targetWidth, height: targetHeight, dpi, kb: outKb });
    }
  } catch (err) {
    console.error('Error during photo processing and download:', err);
    if (statusElem) {
      statusElem.textContent = '❌ An error occurred during processing. Please try again.';
      statusElem.style.color = 'var(--danger)';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnText;
    }
  }
}

/**
 * Embed custom DPI directly into the JPEG JFIF APP0 header
 */
export async function setJpegDpi(blob, dpi) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const view = new DataView(arrayBuffer);
    
    // Check for JPEG SOI (0xFFD8)
    if (view.getUint16(0) !== 0xFFD8) return blob;
    
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      // APP0 marker is 0xFFE0
      if (marker === 0xFFE0) {
        const length = view.getUint16(offset + 2);
        // Check for 'JFIF\0' (0x4A46494600)
        const isJfif = 
          view.getUint8(offset + 4) === 0x4A &&
          view.getUint8(offset + 5) === 0x46 &&
          view.getUint8(offset + 6) === 0x49 &&
          view.getUint8(offset + 7) === 0x46 &&
          view.getUint8(offset + 8) === 0x00;
        
        if (isJfif && length >= 16) {
          // units: 1 = dots per inch (DPI)
          view.setUint8(offset + 11, 1);
          // Xdensity
          view.setUint16(offset + 12, dpi, false);
          // Ydensity
          view.setUint16(offset + 14, dpi, false);
          return new Blob([arrayBuffer], { type: 'image/jpeg' });
        }
      }
      if (marker === 0xFFDA) break;
      const len = view.getUint16(offset + 2);
      offset += 2 + len;
    }
    return blob;
  } catch {
    return blob;
  }
}
