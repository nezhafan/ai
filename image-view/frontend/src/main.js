import { ListImages, IsDir, SaveImage, EncodeIndexedPNG, ReadImage, CopyImageToClipboard, TakePendingOpenPaths, CheckMacOSSecurityStatus, OpenMacOSSecuritySettings, OpenImageDialog, SaveImageDialog } from "../wailsjs/go/backend/App";
import { EventsOn, WindowSetSize, ScreenGetAll, WindowFullscreen, WindowUnfullscreen } from "../wailsjs/runtime/runtime";
import { shouldHandleGlobalHotkey } from "./hotkeys.js";
import { quantizeImageData } from "./image-quantize.js";
import { pickIncomingPath, collectIncomingImagePaths, createRequestGate } from "./open-paths.js";
import { clampCropToBounds, fitCropRegionToRatioWithinBounds, resizeCropRegionWithHandle } from "./crop-geometry.js";
import { calculateImageLayout } from "./image-layout.js";
import { getNextInitialSize, getResetImageState } from "./image-state.js";
import { buildAdaptiveJpegQualityPlan, getTargetJpegByteBudget, resolveJpegQuality } from "./jpeg-quality.js";
import { calculateAutoFitWindowSize } from "./window-fit.js";
import { shouldShowOriginalPngColorOption } from "./png-convert-options.js";
import { createDefaultViewState, getCropButtonAction, isAspectRatioMatch, shouldRenderAdjustPreview } from "./viewer-state.js";
import { buildLocalImageURL, shouldRevokeObjectURL } from "./local-image-url.js";

// === Base64 utility functions ===
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const $img = document.getElementById("image");
const $overlay = document.getElementById("overlay");
const $info = document.getElementById("info");
const $imageSize = document.getElementById("image-size");
const $sizeWidth = document.getElementById("size-width");
const $sizeHeight = document.getElementById("size-height");
const $viewer = document.getElementById("viewer");
const $cropRect = document.getElementById("crop-rect");
const $cropHint = document.getElementById("crop-hint");
const $cropRatioMenu = document.getElementById("crop-ratio-menu");
const $cropSizeLabel = document.getElementById("crop-size-label");
const $btnRotate = document.getElementById("btn-rotate");
const $btnCrop = document.getElementById("btn-crop");
const $btnAdjust = document.getElementById("btn-adjust");
const $btnSave = document.getElementById("btn-save");
const $btnReset = document.getElementById("btn-reset");
const $btnResize = document.getElementById("btn-resize");
const $toolbar = document.getElementById("toolbar");
const $adjustPanel = document.getElementById("adjust-panel");
const $ctxMenu = document.getElementById("context-menu");
const $ctxCopy = document.getElementById("ctx-copy");
const $ctxShare = document.getElementById("ctx-share");
const $jpgQualitySubmenu = document.getElementById("jpg-quality-submenu");
const $pngColorSubmenu = document.getElementById("png-color-submenu");
const $ctxToJpg = document.getElementById("ctx-to-jpg");
const $ctxToPng = document.getElementById("ctx-to-png");
const $loadingOverlay = document.getElementById("loading-overlay");
const $errorOverlay = document.getElementById("error-overlay");
$img.decoding = "async";

let images = [];
let currentIndex = -1;
const defaultViewState = createDefaultViewState();
let scale = defaultViewState.scale;
let rotation = defaultViewState.rotation;
let hasChanges = defaultViewState.hasChanges;
let isCropping = defaultViewState.isCropping;
let cropRegion = null;
let cropStart = null;
let tempCrop = null;
let currentCropRatio = 0;
let isAdjusting = false;

let adjustState = {
  brightness: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  activeFilter: "none",
};

let isDraggingImage = false;
let imageDragStart = { x: 0, y: 0 };
let imageOffset = { ...defaultViewState.imageOffset };
let imageScale = 1;
let originalWidth = 0;
let originalHeight = 0;
let initialWidth = 0;
let initialHeight = 0;
let isResizingCrop = false;
let resizeHandle = null;
let currentCropCursor = "default";
let cropDragStartRect = null;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "heic", "heif", "tif", "tiff"]);
const showImageGate = createRequestGate();
let openIncomingChain = Promise.resolve();
let currentFullImageLoad = null;
let currentImageByteSize = 0;
let currentImageMime = "";
const WINDOW_MIN_WIDTH = 800;
const WINDOW_MIN_HEIGHT = 600;
const WINDOW_CONTENT_PADDING_X = 0;
const WINDOW_CONTENT_PADDING_Y = 0;
const WINDOW_CHROME_HEIGHT = 34;
const POINTER_ZOOM_DELTA = 0.04;

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function convertAndSaveImageFromContextMenu(options = {}) {
  hideContextMenu();
  $loadingOverlay.querySelector("p").textContent = "转换中...";
  $loadingOverlay.classList.remove("hidden");
  await waitForNextPaint();
  await convertAndSaveImage(false, options);
}

function fitImageToViewer() {
  const layout = calculateImageLayout({
    imageWidth: $img.naturalWidth,
    imageHeight: $img.naturalHeight,
    viewerWidth: $viewer.clientWidth,
    viewerHeight: $viewer.clientHeight,
    rotation,
  });
  if (!layout) return;

  $img.style.width = `${layout.renderWidth}px`;
  $img.style.height = `${layout.renderHeight}px`;
  $img.style.maxWidth = "none";
  $img.style.maxHeight = "none";
}

function setCropMode(active) {
  isCropping = active;
  $cropHint.classList.add("hidden");
  setCropCursor(active ? "crosshair" : "default");
}

function updateTransform(options = {}) {
  const { forceReflow = false } = options;
  fitImageToViewer();
  if (forceReflow) {
    $img.style.transform = "none";
    void $img.offsetWidth;
  }
  const transform = `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${scale}) rotate(${rotation}deg)`;
  $img.style.transform = transform;
  syncPreviewImagePresentation(transform);
}

function syncPreviewImagePresentation(transform = $img.style.transform) {
  if (!previewImg) return;

  previewImg.style.position = "absolute";
  previewImg.style.width = $img.style.width || `${$img.width}px`;
  previewImg.style.height = $img.style.height || `${$img.height}px`;
  previewImg.style.objectFit = "contain";
  previewImg.style.filter = $img.style.filter;
  previewImg.style.pointerEvents = "none";
  previewImg.style.transformOrigin = "center center";
  previewImg.style.transform = transform;
}

function updateInfo() {
  if (currentIndex < 0 || images.length === 0) {
    $info.classList.remove("show");
    $info.textContent = "";
    return;
  }
  $info.textContent = `${currentIndex + 1} / ${images.length} · ${images[currentIndex].split(/[/\\]/).pop()}`;
  $info.classList.add("show");
}

function updateToolbarVisibility() {
  const hasImage = currentIndex >= 0 && images.length > 0;
  $toolbar.style.display = hasImage ? "" : "none";
  $imageSize.classList.toggle("show", hasImage);
}

function updateOverlayHint() {
  const hasImage = currentIndex >= 0 && images.length > 0;
  const f11Hint = document.getElementById("f11-hint");
  if (f11Hint) {
    f11Hint.style.display = hasImage ? "" : "none";
  }
}

function updateImageSize() {
  if (currentIndex < 0 || images.length === 0 || !$img.naturalWidth) {
    $imageSize.classList.remove("show");
    return;
  }

  originalWidth = $img.naturalWidth;
  originalHeight = $img.naturalHeight;

  if (document.activeElement === $sizeWidth || document.activeElement === $sizeHeight) {
    return;
  }

  $sizeWidth.value = originalWidth;
  $sizeHeight.value = originalHeight;

  $sizeWidth.max = initialWidth > 0 ? initialWidth : originalWidth;
  $sizeHeight.max = initialHeight > 0 ? initialHeight : originalHeight;

  $imageSize.classList.add("show");
}

function setInitialSize() {
  const next = getNextInitialSize({
    currentWidth: initialWidth,
    currentHeight: initialHeight,
    naturalWidth: $img.naturalWidth,
    naturalHeight: $img.naturalHeight,
  });
  initialWidth = next.width;
  initialHeight = next.height;
}

function replaceInitialSize() {
  const next = getNextInitialSize({
    currentWidth: initialWidth,
    currentHeight: initialHeight,
    naturalWidth: $img.naturalWidth,
    naturalHeight: $img.naturalHeight,
    replace: true,
  });
  initialWidth = next.width;
  initialHeight = next.height;
}

function resetSizeInputs() {
  if (initialWidth === 0 || initialHeight === 0) return;
  $sizeWidth.value = initialWidth;
  $sizeHeight.value = initialHeight;
}

function revokeCurrentSrc() {
  if (shouldRevokeObjectURL($img.src)) {
    URL.revokeObjectURL($img.src);
  }
}

function revokeBlobUrl(url) {
  if (shouldRevokeObjectURL(url)) {
    URL.revokeObjectURL(url);
  }
}

function swapImageSource(url) {
  const oldSrc = $img.src;
  $img.src = url;
  if (oldSrc && oldSrc !== url) {
    revokeBlobUrl(oldSrc);
  }
}

async function waitForImageReady(url) {
  const probe = new Image();
  probe.decoding = "async";
  probe.src = url;

  if (typeof probe.decode === "function") {
    try {
      await probe.decode();
      return;
    } catch {
      // Safari fallback
    }
  }

  await new Promise((resolve, reject) => {
    if (probe.complete) {
      if (probe.naturalWidth > 0) {
        resolve();
      } else {
        reject(new Error("image decode failed"));
      }
      return;
    }
    probe.onload = () => resolve();
    probe.onerror = () => reject(new Error("image decode failed"));
  });
}

async function readImageFile(path) {
  const base64 = await ReadImage(path);
  const bytes = base64ToUint8Array(base64);
  const blob = new Blob([bytes]);
  return {
    url: URL.createObjectURL(blob),
    sizeBytes: bytes.byteLength,
    mime: blob.type || getMimeType(path),
  };
}

async function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to encode image blob"));
      }
    }, mime, quality);
  });
}

async function encodeCanvasWithAdaptiveJpegQuality(canvas, requestedQuality) {
  const targetBytes = getTargetJpegByteBudget({
    sourceMime: currentImageMime,
    sourceBytes: currentImageByteSize,
  });

  const qualityPlan = targetBytes
    ? buildAdaptiveJpegQualityPlan(requestedQuality)
    : [resolveJpegQuality(requestedQuality)];

  let selectedBlob = null;
  for (const quality of qualityPlan) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    selectedBlob = blob;
    if (!targetBytes || blob.size <= targetBytes) {
      break;
    }
  }

  return selectedBlob;
}

async function fitWindowToImage() {
  if (!$img.naturalWidth || !$img.naturalHeight) return;

  try {
    const screens = await ScreenGetAll();
    const primary = (Array.isArray(screens) ? screens.find((s) => s.isPrimary) : null) || (Array.isArray(screens) ? screens[0] : null);
    if (!primary) return;

    const scaleFactor = primary.scaleFactor || window.devicePixelRatio || 1;
    const workAreaSize = { width: primary.width, height: primary.height };
    if (!workAreaSize) return;

    const toolbarHeight = $toolbar?.offsetHeight || 0;
    const rotated = rotation % 180 !== 0;
    const fittedSize = calculateAutoFitWindowSize({
      imageWidth: rotated ? $img.naturalHeight : $img.naturalWidth,
      imageHeight: rotated ? $img.naturalWidth : $img.naturalHeight,
      toolbarHeight,
      workAreaWidth: workAreaSize.width,
      workAreaHeight: workAreaSize.height,
      scaleFactor,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      chromeHeight: WINDOW_CHROME_HEIGHT,
      paddingX: WINDOW_CONTENT_PADDING_X,
      paddingY: WINDOW_CONTENT_PADDING_Y,
    });
    if (!fittedSize) return;
    await WindowSetSize(fittedSize.width, fittedSize.height);
  } catch (e) {
    console.warn("fitWindowToImage failed:", e);
  }
}

function applyReadFailure() {
  const failedIndex = currentIndex;
  images.splice(failedIndex, 1);
  if (images.length === 0) {
    currentIndex = -1;
  } else if (failedIndex >= images.length) {
    currentIndex = images.length - 1;
  } else {
    currentIndex = failedIndex;
  }
  $img.src = "";
  $img.style.visibility = "hidden";
  $info.classList.remove("show");
  $info.textContent = "";
  $errorOverlay.classList.remove("hidden");
  updateToolbarVisibility();
  updateOverlayHint();
}

async function showImage(index, options = {}) {
  const { autoFitWindow = false } = options;
  if (images.length === 0) return;
  if (index < 0) index = images.length - 1;
  if (index >= images.length) index = 0;

  const requestToken = showImageGate.next();
  currentFullImageLoad = null;
  currentIndex = index;
  initialWidth = 0;
  initialHeight = 0;
  scale = defaultViewState.scale;
  imageScale = 1;
  imageOffset = { ...defaultViewState.imageOffset };
  rotation = defaultViewState.rotation;
  hasChanges = defaultViewState.hasChanges;
  cropRegion = null;
  adjustState = {
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    activeFilter: "none",
  };
  hideCropRect();
  setCropMode(defaultViewState.isCropping);
  $cropRatioMenu.classList.add("hidden");
  $cropSizeLabel.classList.add("hidden");
  closeAdjustPanel();
  updateTransform();
  $img.style.filter = "";
  $img.style.visibility = "visible";

  const currentPath = images[currentIndex];
  const finalUrl = buildLocalImageURL(currentPath);
  if (window.location.protocol === "http:") {
    console.log("[showImage] image path:", currentPath);
    console.log("[showImage] image url:", finalUrl);
  }
  currentImageByteSize = 0;
  currentImageMime = getMimeType(currentPath);
  swapImageSource(finalUrl);

  currentFullImageLoad = (async () => {
    try {
      await new Promise((resolve, reject) => {
        if ($img.complete) {
          if ($img.naturalWidth > 0) {
            resolve();
          } else {
            reject(new Error("image decode failed"));
          }
          return;
        }
        $img.onload = () => resolve();
        $img.onerror = () => reject(new Error("image decode failed"));
      });
    } catch (e) {
      if (!showImageGate.isCurrent(requestToken)) return;
      console.error("[showImage] failed to decode image:", e);
      applyReadFailure();
      return;
    }

    if (!showImageGate.isCurrent(requestToken)) {
      return;
    }

    updateTransform();
    updateAdjustUI();
    updateImageSize();
    replaceInitialSize();

    if (autoFitWindow) {
      await fitWindowToImage();
    }
  })();

  $overlay.classList.remove("show");
  $errorOverlay.classList.add("hidden");
  updateInfo();
  updateSaveButtonState();
  updateToolbarVisibility();
  updateOverlayHint();
}

async function ensureCurrentImageLoadedForExport() {
  if (!currentFullImageLoad) return;
  try {
    await currentFullImageLoad;
  } catch (e) {
    console.warn("ensureCurrentImageLoadedForExport failed:", e);
  }
}

async function loadDir(dirPath) {
  try {
    const list = await ListImages(dirPath);
    if (!list || list.length === 0) {
      alert("该目录下没有找到支持的图片文件");
      return;
    }
    images = list;
    await showImage(0, { autoFitWindow: true });
  } catch (e) {
    console.error(e);
    alert("读取目录失败: " + e);
  }
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").toLowerCase();
}

function isImagePath(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

async function loadPath(path) {
  const isDir = await IsDir(path);
  if (isDir) {
    await loadDir(path);
    return;
  }

  const sep = path.includes("/") ? "/" : "\\";
  const idx = path.lastIndexOf(sep);
  if (idx <= 0) {
    return;
  }

  const dir = path.slice(0, idx);
  const list = await ListImages(dir);
  if (!list || list.length === 0) {
    alert("该目录下没有找到支持的图片文件");
    return;
  }

  images = list;
  const targetIndex = list.findIndex((item) => normalizePath(item) === normalizePath(path));
  await showImage(targetIndex >= 0 ? targetIndex : 0, { autoFitWindow: true });
}

async function openIncomingPathsInternal(paths) {
  try {
    const imageCandidates = collectIncomingImagePaths(paths, isImagePath);
    if (imageCandidates.length > 1) {
      images = imageCandidates;
      await showImage(0, { autoFitWindow: true });
      return;
    }

    const candidate = pickIncomingPath(paths, isImagePath);
    if (!candidate) return;
    await loadPath(candidate);
  } catch (e) {
    console.error("openIncomingPaths failed", e);
    alert("打开文件失败: " + e);
  }
}

function openIncomingPaths(paths) {
  openIncomingChain = openIncomingChain.then(() => openIncomingPathsInternal(paths));
  return openIncomingChain.catch((e) => {
    console.error("openIncomingPaths chain failed", e);
  });
}

async function openImage() {
  try {
    const paths = await OpenImageDialog();
    if (!paths || paths.length === 0) return;
    await openIncomingPaths(paths);
  } catch (e) {
    console.error("OpenImageDialog failed:", e);
  }
}

async function nextImage() {
  if (images.length === 0) return;
  await showImage(currentIndex + 1);
}

async function prevImage() {
  if (images.length === 0) return;
  await showImage(currentIndex - 1);
}

function rotateImage() {
  if (images.length === 0) return;
  rotation = (rotation + 90) % 360;
  updateTransform({ forceReflow: true });
  if (cropRegion) {
    const bounds = getImageBoundsInViewer();
    cropRegion = currentCropRatio > 0
      ? fitCropRegionToRatioWithinBounds(cropRegion, bounds, currentCropRatio)
      : clampCropToBounds(cropRegion, bounds);
    updateCropRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
  }
  hasChanges = true;
  updateSaveButtonState();
}

async function resetView() {
  const resetState = getResetImageState({
    defaultScale: defaultViewState.scale,
    defaultRotation: defaultViewState.rotation,
    defaultImageOffset: defaultViewState.imageOffset,
    originalPath: images[currentIndex],
  });
  scale = resetState.scale;
  imageOffset = { ...resetState.imageOffset };
  rotation = resetState.rotation;
  adjustState = {
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    activeFilter: "none",
  };
  updateTransform();
  cropRegion = null;
  hideCropRect();
  setCropMode(defaultViewState.isCropping);
  $cropRatioMenu.classList.add("hidden");
  $cropSizeLabel.classList.add("hidden");
  closeAdjustPanel();
  resetSizeInputs();

  if (images.length > 0) {
    revokeCurrentSrc();
    const fileData = await readImageFile(resetState.sourcePath);
    currentImageByteSize = fileData.sizeBytes;
    currentImageMime = fileData.mime;
    swapImageSource(fileData.url);
    await new Promise((resolve, reject) => {
      if ($img.complete && $img.naturalWidth > 0) {
        resolve();
        return;
      }
      $img.onload = () => resolve();
      $img.onerror = () => reject(new Error("image reload failed"));
    });
    updateImageSize();
    resetSizeInputs();
    updateTransform({ forceReflow: true });
  }

  $img.style.filter = "";
  $img.style.visibility = "visible";
  hasChanges = false;
  updateSaveButtonState();
  updateAdjustUI();
}

function toggleZoom() {
  if (images.length === 0) return;
  if (scale === 1) {
    scale = 2;
  } else {
    scale = 1;
  }
  updateTransform();
}

function zoom(delta, options = {}) {
  if (images.length === 0) return;
  const { multiplicative = false } = options;
  const nextScale = multiplicative ? scale * (1 + delta) : scale + delta;
  scale = Math.min(Math.max(nextScale, 0.1), 10);
  updateTransform();
}

function getMimeType(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

async function getEditedCanvas() {
  const nw = $img.naturalWidth;
  const nh = $img.naturalHeight;
  if (!nw || !nh) return null;

  let canvas, ctx;

  if (rotation === 0) {
    canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    ctx = canvas.getContext("2d");
    ctx.drawImage($img, 0, 0);
  } else {
    const w = rotation % 180 === 0 ? nw : nh;
    const h = rotation % 180 === 0 ? nh : nw;
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext("2d");
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage($img, -nw / 2, -nh / 2);
  }

  if (adjustState.activeFilter !== "none") {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyFilter(imageData, adjustState.activeFilter);
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
}

async function saveImage() {
  if (images.length === 0) return;

  await ensureCurrentImageLoadedForExport();

  let canvas = await getEditedCanvas();
  if (!canvas) {
    console.warn("[saveImage] getEditedCanvas returned null");
    return;
  }

  if (cropRegion) {
    canvas = await applyCropToCanvas(canvas);
    setCropMode(defaultViewState.isCropping);
    clearCropSelection();
  }

  const mime = getMimeType(images[currentIndex]);
  const quality = mime === "image/jpeg" ? resolveJpegQuality() : undefined;
  const blob = mime === "image/jpeg"
    ? await encodeCanvasWithAdaptiveJpegQuality(canvas, quality)
    : await canvasToBlob(canvas, mime, quality);
  const buf = await blob.arrayBuffer();
  const base64Data = uint8ArrayToBase64(new Uint8Array(buf));

  const ext = images[currentIndex].split(".").pop().toLowerCase();
  const fileName = images[currentIndex].split(/[/\\]/).pop();

  try {
    const savePath = await SaveImageDialog(fileName, ext);

    if (!savePath) {
      return;
    }

    await SaveImage(savePath, base64Data);
    hasChanges = defaultViewState.hasChanges;
    rotation = defaultViewState.rotation;
    scale = defaultViewState.scale;
    adjustState = {
      brightness: 0,
      contrast: 0,
      shadows: 0,
      highlights: 0,
      activeFilter: "none",
    };
    updateTransform();
    updateSaveButtonState();
    revokeCurrentSrc();
    const fileData = await readImageFile(images[currentIndex]);
    currentImageByteSize = fileData.sizeBytes;
    currentImageMime = fileData.mime;
    $img.src = fileData.url;
    $img.style.filter = "";
    $img.style.visibility = "visible";
  } catch (e) {
    console.error("[saveImage] error:", e);
    alert("保存失败: " + e);
  }
}

function hideCropRect() {
  $cropRect.classList.add("hidden");
}

function clearCropSelection() {
  cropRegion = null;
  tempCrop = null;
  cropStart = null;
  hideCropRect();
  $cropSizeLabel.classList.add("hidden");
  $cropRatioMenu.classList.add("hidden");
  setCropCursor(isCropping ? "crosshair" : "default");
  updateSaveButtonState();
}

function updateCropRect(x, y, w, h) {
  $cropRect.style.left = `${x}px`;
  $cropRect.style.top = `${y}px`;
  $cropRect.style.width = `${w}px`;
  $cropRect.style.height = `${h}px`;
  $cropRect.classList.remove("hidden");

  if (w > 20 && h > 20) {
    $cropSizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    $cropSizeLabel.style.left = `${x + w / 2 - 30}px`;
    $cropSizeLabel.style.top = `${y + h + 4}px`;
    $cropSizeLabel.classList.remove("hidden");
  } else {
    $cropSizeLabel.classList.add("hidden");
  }
}

function enterCropMode() {
  if (images.length === 0) return;
  setCropMode(true);
}

function exitCropMode() {
  setCropMode(false);
  cropStart = null;
  tempCrop = null;
  isDraggingCrop = false;
  isResizingCrop = false;
  resizeHandle = null;
  cropDragStartRect = null;
  $cropRatioMenu.classList.add("hidden");
  $cropSizeLabel.classList.add("hidden");
}

function toggleCropMode() {
  if (isCropping) {
    exitCropMode();
    cropRegion = null;
    currentCropRatio = 0;
    document.querySelectorAll(".ratio-item").forEach((el) => el.classList.remove("active"));
    clearCropSelection();
  } else {
    enterCropMode();
    if (cropRegion) {
      $cropRatioMenu.classList.remove("hidden");
    }
  }
}

function setCropCursor(cursor) {
  const resolved = cursor || "crosshair";
  currentCropCursor = resolved;
  $viewer.style.cursor = resolved;
  $img.style.cursor = resolved;
}

function getCropHitHandle(mouseX, mouseY, threshold = 8) {
  if (!cropRegion) return null;
  const { x, y, width, height } = cropRegion;
  const right = x + width;
  const bottom = y + height;

  const nearLeft = Math.abs(mouseX - x) <= threshold;
  const nearRight = Math.abs(mouseX - right) <= threshold;
  const nearTop = Math.abs(mouseY - y) <= threshold;
  const nearBottom = Math.abs(mouseY - bottom) <= threshold;
  const insideX = mouseX >= x && mouseX <= right;
  const insideY = mouseY >= y && mouseY <= bottom;

  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && insideX) return "n";
  if (nearBottom && insideX) return "s";
  if (nearLeft && insideY) return "w";
  if (nearRight && insideY) return "e";
  if (insideX && insideY) return "move";
  return null;
}

function cursorFromCropHandle(handle, dragging = false) {
  if (handle === "move") return dragging ? "grabbing" : "grab";
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "crosshair";
}

async function applyCropToCanvas(sourceCanvas) {
  const viewerRect = $viewer.getBoundingClientRect();
  const imgRect = $img.getBoundingClientRect();

  let renderScale;
  if (rotation % 180 === 0) {
    renderScale = imgRect.width / $img.naturalWidth;
  } else {
    renderScale = imgRect.width / $img.naturalHeight;
  }

  if (renderScale <= 0) return sourceCanvas;

  const cropCenterX = cropRegion.x + cropRegion.width / 2;
  const cropCenterY = cropRegion.y + cropRegion.height / 2;
  const imgCenterX = imgRect.left + imgRect.width / 2 - viewerRect.left;
  const imgCenterY = imgRect.top + imgRect.height / 2 - viewerRect.top;

  const dx = (cropCenterX - imgCenterX) / renderScale;
  const dy = (cropCenterY - imgCenterY) / renderScale;
  const cw = cropRegion.width / renderScale;
  const ch = cropRegion.height / renderScale;

  const cx = sourceCanvas.width / 2 + dx - cw / 2;
  const cy = sourceCanvas.height / 2 + dy - ch / 2;

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw));
  out.height = Math.max(1, Math.round(ch));
  out.getContext("2d").drawImage(
    sourceCanvas,
    Math.round(cx),
    Math.round(cy),
    Math.round(cw),
    Math.round(ch),
    0,
    0,
    out.width,
    out.height
  );
  return out;
}

async function confirmCrop() {
  if (!cropRegion || !isCropping) return;

  const canvas = await getEditedCanvas();
  if (!canvas) return;

  const out = await applyCropToCanvas(canvas);

  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);
  revokeCurrentSrc();
  $img.src = url;

  clearCropSelection();
  rotation = defaultViewState.rotation;
  scale = defaultViewState.scale;
  imageOffset = { ...defaultViewState.imageOffset };
  updateTransform();
  hasChanges = true;
  updateSaveButtonState();
  setCropMode(false);
}

// Keyboard events
document.addEventListener("keydown", (e) => {
  if (!shouldHandleGlobalHotkey(e)) return;

  if (e.key === "ArrowRight") nextImage();
  else if (e.key === "ArrowLeft") prevImage();
  else if (e.key === "r" || e.key === "R") rotateImage();
  else if (e.key === "0") {
    if (images.length === 0) openImage();
    else resetView();
  }
  else if (e.key === "o" || e.key === "O") openImage();
  else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    zoom(0.1);
  } else if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
    e.preventDefault();
    zoom(-0.1);
  } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    e.preventDefault();
    scale = defaultViewState.scale;
    imageOffset = { ...defaultViewState.imageOffset };
    updateTransform({ forceReflow: true });
  }
  else if (e.key === "Enter" && isCropping) {
    e.preventDefault();
    confirmCrop();
  } else if (e.key === "Escape" && isCropping) {
    clearCropSelection();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveImage();
  } else if (e.key === "F11") {
    e.preventDefault();
    toggleFullscreen();
  }
});

document.addEventListener("wheel", (e) => {
  if (images.length === 0) return;
  if (!(e.ctrlKey || e.metaKey)) return;

  e.preventDefault();
  const delta = e.deltaY > 0 ? -POINTER_ZOOM_DELTA : POINTER_ZOOM_DELTA;
  zoom(delta, { multiplicative: true });
}, { passive: false });

// Fullscreen toggle
let isFullscreen = false;
async function toggleFullscreen() {
  try {
    if (isFullscreen) {
      await WindowUnfullscreen();
      isFullscreen = false;
    } else {
      await WindowFullscreen();
      isFullscreen = true;
    }
  } catch (e) {
    console.warn("toggleFullscreen failed:", e);
  }
}

// Drag and drop via HTML5 API
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const paths = [];

  // Try to get paths from files
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    for (const file of e.dataTransfer.files) {
      if (file.path) {
        paths.push(file.path);
      }
    }
  }

  // Fallback: try text/uri-list
  if (paths.length === 0) {
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      for (const line of uriList.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          try {
            const url = new URL(trimmed);
            if (url.protocol === "file:") {
              paths.push(decodeURIComponent(url.pathname));
            }
          } catch {
            // skip invalid
          }
        }
      }
    }
  }

  if (paths.length > 0) {
    openIncomingPaths(paths);
  }
});

window.addEventListener("resize", () => {
  if (images.length > 0) {
    fitImageToViewer();
    updateTransform();
  }
});

// Initial UI state
updateToolbarVisibility();
updateOverlayHint();

// Double-click to zoom
$img.addEventListener("dblclick", toggleZoom);

// Crop mouse events
let isDraggingCrop = false;
let dragOffset = { x: 0, y: 0 };

function getImageBoundsInViewer() {
  const layout = calculateImageLayout({
    imageWidth: $img.naturalWidth,
    imageHeight: $img.naturalHeight,
    viewerWidth: $viewer.clientWidth,
    viewerHeight: $viewer.clientHeight,
    rotation,
  });
  if (!layout) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const boundsWidth = layout.boundsWidth * scale;
  const boundsHeight = layout.boundsHeight * scale;
  const left = ($viewer.clientWidth - boundsWidth) / 2 + imageOffset.x;
  const top = ($viewer.clientHeight - boundsHeight) / 2 + imageOffset.y;

  return {
    left,
    top,
    right: left + boundsWidth,
    bottom: top + boundsHeight,
  };
}

function clampPointToBounds(x, y, bounds) {
  return {
    x: Math.max(bounds.left, Math.min(bounds.right, x)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, y)),
  };
}

$viewer.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (images.length === 0) return;

  const viewerRect = $viewer.getBoundingClientRect();
  const mouseX = e.clientX - viewerRect.left;
  const mouseY = e.clientY - viewerRect.top;
  const bounds = getImageBoundsInViewer();

  if (isCropping) {
    const hit = getCropHitHandle(mouseX, mouseY);
    if (hit === "move" && cropRegion) {
      isDraggingCrop = true;
      isResizingCrop = false;
      dragOffset = { x: mouseX - cropRegion.x, y: mouseY - cropRegion.y };
      cropStart = null;
      setCropCursor(cursorFromCropHandle(hit, true));
      e.stopPropagation();
      return;
    }

    if (hit && hit !== "move" && cropRegion) {
      isDraggingCrop = false;
      isResizingCrop = true;
      resizeHandle = hit;
      cropDragStartRect = { ...cropRegion };
      cropStart = null;
      setCropCursor(cursorFromCropHandle(hit, true));
      e.stopPropagation();
      return;
    }

    if (!hit && cropRegion) {
      clearCropSelection();
      return;
    }

    if (mouseX < bounds.left || mouseX > bounds.right || mouseY < bounds.top || mouseY > bounds.bottom) {
      return;
    }

    const clamped = clampPointToBounds(mouseX, mouseY, bounds);
    cropStart = { x: clamped.x, y: clamped.y };
    isDraggingCrop = false;
    isResizingCrop = false;
    resizeHandle = null;
    cropDragStartRect = null;
    setCropCursor("crosshair");
    return;
  }

  if (mouseX >= bounds.left && mouseX <= bounds.right &&
      mouseY >= bounds.top && mouseY <= bounds.bottom) {
    isDraggingImage = true;
    imageDragStart = { x: mouseX, y: mouseY };
    $img.classList.add("dragging");
  }
});

window.addEventListener("mousemove", (e) => {
  const viewerRect = $viewer.getBoundingClientRect();
  const bounds = getImageBoundsInViewer();

  let cx = e.clientX - viewerRect.left;
  let cy = e.clientY - viewerRect.top;

  if (isDraggingImage) {
    const deltaX = cx - imageDragStart.x;
    const deltaY = cy - imageDragStart.y;
    imageOffset.x += deltaX;
    imageOffset.y += deltaY;
    imageDragStart.x = cx;
    imageDragStart.y = cy;
    updateTransform();
    return;
  }

  if (!isCropping) return;

  if (isDraggingCrop && cropRegion) {
    let newX = cx - dragOffset.x;
    let newY = cy - dragOffset.y;

    if (newX < bounds.left) newX = bounds.left;
    if (newY < bounds.top) newY = bounds.top;
    if (newX + cropRegion.width > bounds.right) newX = bounds.right - cropRegion.width;
    if (newY + cropRegion.height > bounds.bottom) newY = bounds.bottom - cropRegion.height;

    cropRegion.x = newX;
    cropRegion.y = newY;
    updateCropRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
    updateSaveButtonState();
    setCropCursor("grabbing");
    return;
  }

  if (isResizingCrop && resizeHandle && cropDragStartRect) {
    const clamped = clampPointToBounds(cx, cy, bounds);
    cropRegion = resizeCropRegionWithHandle(
      cropDragStartRect,
      resizeHandle,
      clamped.x,
      clamped.y,
      bounds,
      currentCropRatio
    );
    updateCropRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
    updateSaveButtonState();
    setCropCursor(cursorFromCropHandle(resizeHandle, true));
    return;
  }

  if (!cropStart) {
    setCropCursor(cursorFromCropHandle(getCropHitHandle(cx, cy)));
    return;
  }

  const clampedCurrent = clampPointToBounds(cx, cy, bounds);
  cx = clampedCurrent.x;
  cy = clampedCurrent.y;

  const clampedStart = clampPointToBounds(cropStart.x, cropStart.y, bounds);
  const startX = clampedStart.x;
  const startY = clampedStart.y;

  let x = Math.min(startX, cx);
  let y = Math.min(startY, cy);
  let w = Math.abs(cx - startX);
  let h = Math.abs(cy - startY);

  if (currentCropRatio > 0) {
    if (w > h * currentCropRatio) {
      w = h * currentCropRatio;
      if (cx < cropStart.x) x = cropStart.x - w;
    } else {
      h = w / currentCropRatio;
      if (cy < cropStart.y) y = cropStart.y - h;
    }
    if (x < bounds.left) x = bounds.left;
    if (y < bounds.top) y = bounds.top;
    if (x + w > bounds.right) { w = bounds.right - x; h = w / currentCropRatio; }
    if (y + h > bounds.bottom) { h = bounds.bottom - y; w = h * currentCropRatio; }
  }

  updateCropRect(x, y, w, h);
  tempCrop = { x, y, width: w, height: h };
  setCropCursor("crosshair");

  if (tempCrop && tempCrop.width > 2 && tempCrop.height > 2) {
    updateSaveButtonState();
  }
});

window.addEventListener("mouseup", () => {
  if (isDraggingImage) {
    isDraggingImage = false;
    $img.classList.remove("dragging");
    return;
  }

  if (!isCropping) return;
  if (isDraggingCrop) {
    isDraggingCrop = false;
    setCropCursor("grab");
    return;
  }

  if (isResizingCrop) {
    isResizingCrop = false;
    cropDragStartRect = null;
    setCropCursor(cursorFromCropHandle(resizeHandle));
    resizeHandle = null;
    return;
  }
  cropStart = null;
  if (tempCrop && tempCrop.width > 2 && tempCrop.height > 2) {
    cropRegion = tempCrop;
    $cropRatioMenu.classList.remove("hidden");
    updateSaveButtonState();
  }
  tempCrop = null;
  setCropCursor("crosshair");
});

// Context menu
function showContextMenu(e) {
  e.preventDefault();
  if (images.length === 0) return;

  hideAllSubmenus();

  const originalColorItem = $pngColorSubmenu.querySelector('[data-colors="0"]');
  if (originalColorItem) {
    const currentPath = images[currentIndex];
    originalColorItem.style.display = shouldShowOriginalPngColorOption(currentPath) ? "" : "none";
  }

  $ctxMenu.style.left = `${e.clientX}px`;
  $ctxMenu.style.top = `${e.clientY}px`;
  $ctxMenu.classList.remove("hidden");
}

function hideContextMenu() {
  $ctxMenu.classList.add("hidden");
}

function hideAllSubmenus() {
  $jpgQualitySubmenu.classList.add("hidden");
  $pngColorSubmenu.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (!$ctxMenu.contains(e.target)) {
    hideContextMenu();
  }
});

document.addEventListener("contextmenu", showContextMenu);

// Copy image
async function copyImage() {
  hideContextMenu();
  if (images.length === 0) return;

  try {
    await ensureCurrentImageLoadedForExport();
    if (cropRegion || rotation !== 0) {
      let canvas = await getEditedCanvas();
      if (!canvas) return;

      if (cropRegion) {
        canvas = await applyCropToCanvas(canvas);
      }

      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const buf = await blob.arrayBuffer();
      const base64Data = uint8ArrayToBase64(new Uint8Array(buf));

      const tmpPath = `/tmp/cropped_image_${Date.now()}.png`;
      await SaveImage(tmpPath, base64Data);

      await CopyImageToClipboard(tmpPath);
    } else {
      await CopyImageToClipboard(images[currentIndex]);
    }
  } catch (e) {
    console.error("[copyImage] failed:", e);
    alert("拷贝图片失败: " + (e?.message || e));
  }
}

// Share image
async function shareImage() {
  hideContextMenu();
  if (images.length === 0) return;

  try {
    await ensureCurrentImageLoadedForExport();
    const canvas = await getEditedCanvas();
    if (!canvas) return;

    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const file = new File([blob], "image.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      await convertAndSaveImage(true);
    }
  } catch (e) {
    console.error("shareImage failed:", e);
    if (e.name !== "AbortError") {
      alert("分享失败");
    }
  }
}

// Format conversion and save
async function convertAndSaveImage(isShare = false, options = {}) {
  if (images.length === 0) return;

  try {
    await ensureCurrentImageLoadedForExport();
    const { quality, colors, targetMime: optTargetMime, targetExt: optTargetExt } = options;

    let targetMime = optTargetMime;
    let targetExt = optTargetExt;

    if (!targetMime || !targetExt) {
      const ext = images[currentIndex].split(".").pop()?.toLowerCase();
      const isJpg = ext === "jpg" || ext === "jpeg";
      targetMime = isJpg ? "image/png" : "image/jpeg";
      targetExt = isJpg ? "png" : "jpg";
    }

    const targetQuality = targetMime === "image/jpeg"
      ? resolveJpegQuality(quality)
      : undefined;

    const canvas = await getEditedCanvas();
    if (!canvas) return;

    let finalCanvas = canvas;
    let indexedPngBase64 = null;
    if (colors !== undefined && colors > 0 && targetMime === "image/png") {
      finalCanvas = await convertToColorPalette(canvas, colors, true);
      const ctx = finalCanvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
      try {
        const rgbaBase64 = uint8ArrayToBase64(new Uint8Array(imageData.data));
        indexedPngBase64 = await EncodeIndexedPNG(rgbaBase64, finalCanvas.width, finalCanvas.height);
      } catch (e) {
        console.warn("EncodeIndexedPNG failed, fallback to regular PNG encoding", e);
        indexedPngBase64 = null;
      }
    }

    const blob = targetMime === "image/jpeg"
      ? await encodeCanvasWithAdaptiveJpegQuality(finalCanvas, targetQuality)
      : await canvasToBlob(finalCanvas, targetMime, targetQuality);
    const buf = await blob.arrayBuffer();
    const base64Data = uint8ArrayToBase64(new Uint8Array(buf));

    const originalName = images[currentIndex].split(/[/\\]/).pop();
    const baseName = originalName.replace(/\.[^.]+$/, "");
    const fileName = `${baseName}.${targetExt}`;

    if (isShare) {
      const file = new File([blob], fileName, { type: targetMime });
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name !== "AbortError") {
          console.error("share failed:", e);
        }
      }
      return;
    }

    const savePath = await SaveImageDialog(fileName, targetExt);
    if (!savePath) return;

    if (indexedPngBase64 && targetMime === "image/png") {
      await SaveImage(savePath, indexedPngBase64);
    } else {
      await SaveImage(savePath, base64Data);
    }
  } catch (e) {
    console.error("convertAndSaveImage failed:", e);
    alert("保存失败: " + e);
  } finally {
    $loadingOverlay.classList.add("hidden");
  }
}

async function convertToColorPalette(canvas, numColors, dither = true) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  if (numColors === 0) {
    return canvas;
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const quantized = quantizeImageData(imageData, numColors, { dither });

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d");
  const outImageData = outCtx.createImageData(width, height);
  outImageData.data.set(quantized.data);
  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas;
}

function updateSaveButtonState() {
  const hasCropSelection = (cropRegion !== null) || (tempCrop !== null && tempCrop.width > 2 && tempCrop.height > 2);
  const canSave = (rotation % 360 !== 0) || hasCropSelection || hasChanges;
  $btnSave.disabled = !canSave;
}

// Context menu events
$ctxCopy.addEventListener("click", copyImage);
$ctxShare.addEventListener("click", shareImage);

$ctxToJpg.addEventListener("mouseenter", (e) => {
  hideAllSubmenus();
  $jpgQualitySubmenu.classList.remove("hidden");
});

$ctxToPng.addEventListener("mouseenter", (e) => {
  hideAllSubmenus();
  $pngColorSubmenu.classList.remove("hidden");
});

$jpgQualitySubmenu.querySelectorAll(".submenu-item").forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.stopPropagation();
    const quality = parseFloat(item.dataset.quality);
    await convertAndSaveImageFromContextMenu({ quality, targetMime: "image/jpeg", targetExt: "jpg" });
  });
});

$pngColorSubmenu.querySelectorAll(".submenu-item").forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.stopPropagation();
    const colors = parseInt(item.dataset.colors, 10);
    await convertAndSaveImageFromContextMenu({ colors, targetMime: "image/png", targetExt: "png" });
  });
});

// Toolbar events
$btnRotate.addEventListener("click", rotateImage);
$btnAdjust.addEventListener("click", toggleAdjustPanel);
$btnSave.addEventListener("click", saveImage);
$btnReset.addEventListener("click", resetView);

$btnCrop.addEventListener("click", () => {
  if (images.length === 0) return;

  const action = getCropButtonAction({
    isCropping,
    hasSelection: Boolean(cropRegion),
  });

  if (action === "confirm") {
    confirmCrop();
    return;
  }

  if (action === "cancel") {
    exitCropMode();
    clearCropSelection();
    return;
  }

  enterCropMode();

  if (!cropRegion) {
    const bounds = getImageBoundsInViewer();
    const imgW = bounds.right - bounds.left;
    const imgH = bounds.bottom - bounds.top;
    const defaultRatio = 4 / 3;

    let boxW, boxH;
    if (imgW / imgH > defaultRatio) {
      boxH = imgH * 0.75;
      boxW = boxH * defaultRatio;
    } else {
      boxW = imgW * 0.75;
      boxH = boxW / defaultRatio;
    }

    const boxX = bounds.left + (imgW - boxW) / 2;
    const boxY = bounds.top + (imgH - boxH) / 2;

    cropRegion = { x: boxX, y: boxY, width: boxW, height: boxH };
    currentCropRatio = defaultRatio;
    updateCropRect(boxX, boxY, boxW, boxH);
    $cropRatioMenu.classList.remove("hidden");

    document.querySelectorAll(".ratio-item").forEach((el) => {
      el.classList.toggle("active", isAspectRatioMatch(parseFloat(el.dataset.ratio), defaultRatio));
    });
    updateSaveButtonState();
  }
});

// Crop ratio selection
document.querySelectorAll(".ratio-item").forEach((item) => {
  item.addEventListener("click", () => {
    const ratio = parseFloat(item.dataset.ratio);
    currentCropRatio = ratio;

    document.querySelectorAll(".ratio-item").forEach((el) => el.classList.remove("active"));
    if (ratio > 0) {
      item.classList.add("active");
    }

    if (cropRegion && ratio > 0) {
      const bounds = getImageBoundsInViewer();
      cropRegion = fitCropRegionToRatioWithinBounds(cropRegion, bounds, ratio);
      updateCropRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
    }
  });
});

// Size input handling
$sizeWidth.addEventListener("blur", () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputWidth = parseInt($sizeWidth.value, 10);
  if (isNaN(inputWidth) || inputWidth <= 0 || inputWidth > initialWidth) {
    resetSizeInputs();
    return;
  }
  const newHeight = Math.round((inputWidth / initialWidth) * initialHeight);
  $sizeHeight.value = newHeight;
});

$sizeHeight.addEventListener("blur", () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputHeight = parseInt($sizeHeight.value, 10);
  if (isNaN(inputHeight) || inputHeight <= 0 || inputHeight > initialHeight) {
    resetSizeInputs();
    return;
  }
  const newWidth = Math.round((inputHeight / initialHeight) * initialWidth);
  $sizeWidth.value = newWidth;
});

$btnResize.addEventListener("click", async () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputWidth = parseInt($sizeWidth.value, 10);
  const inputHeight = parseInt($sizeHeight.value, 10);
  if (isNaN(inputWidth) || isNaN(inputHeight) || inputWidth <= 0 || inputHeight <= 0) {
    return;
  }

  if (inputWidth === initialWidth && inputHeight === initialHeight) {
    return;
  }

  const newWidth = Math.min(inputWidth, initialWidth);
  const newHeight = Math.min(inputHeight, initialHeight);

  const fileData = await readImageFile(images[currentIndex]);
  const url = fileData.url;
  const tempImg = new Image();
  await new Promise((resolve, reject) => {
    tempImg.onload = resolve;
    tempImg.onerror = reject;
    tempImg.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(tempImg, 0, 0, newWidth, newHeight);

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))), "image/png");
    });
    const blobUrl = URL.createObjectURL(blob);

    revokeCurrentSrc();
    $img.src = blobUrl;

    await new Promise((resolve) => {
      if ($img.complete && $img.naturalWidth > 0) {
        resolve();
      } else {
        $img.onload = resolve;
      }
    });

    originalWidth = newWidth;
    originalHeight = newHeight;
    scale = defaultViewState.scale;
    imageOffset = { ...defaultViewState.imageOffset };
    rotation = defaultViewState.rotation;
    updateTransform();
    updateImageSize();
    hasChanges = true;
    updateSaveButtonState();
  } catch (e) {
    console.error("Resize failed:", e);
  }
});

// Initialization
updateInfo();
updateSaveButtonState();

$errorOverlay.addEventListener("click", () => {
  $errorOverlay.classList.add("hidden");
});

// Listen for open-paths events from Go backend
EventsOn("open-paths", async (paths) => {
  await openIncomingPaths(paths);
});

// Take pending paths from startup
TakePendingOpenPaths()
  .then(async (paths) => {
    if (paths && paths.length > 0) {
      await openIncomingPaths(paths);
    }
  })
  .catch((e) => {
    console.warn("TakePendingOpenPaths failed:", e);
  });

// macOS security status check
CheckMacOSSecurityStatus()
  .then((status) => {
    if (!status?.supported) return;
    if (status.allowed && !status.quarantined && !status.translocated) return;

    const reasons = [];
    if (!status.allowed) reasons.push("系统尚未明确允许该应用");
    if (status.quarantined) reasons.push("应用仍带有隔离标记");
    if (status.translocated) reasons.push("应用正在 App Translocation 临时路径运行");
    const tip = reasons.join(",");

    if (confirm(`检测到当前应用安全状态可能影响"打开方式"与文件关联：${tip}。\n是否现在打开"系统设置 > 隐私与安全性"页面？`)) {
      OpenMacOSSecuritySettings().catch((e) => {
        console.warn("OpenMacOSSecuritySettings failed:", e);
      });
    }
  })
  .catch((e) => {
    console.warn("CheckMacOSSecurityStatus failed:", e);
  });

// ========== Adjust panel ==========

function toggleAdjustPanel() {
  isAdjusting = !isAdjusting;
  if (isAdjusting) {
    $adjustPanel.classList.remove("hidden");
    exitCropMode();
  } else {
    $adjustPanel.classList.add("hidden");
    setCropMode(defaultViewState.isCropping);
  }
}

function closeAdjustPanel() {
  isAdjusting = false;
  $adjustPanel.classList.add("hidden");
  hideAdjustPreview();
}

let previewThrottleTimer = null;

function updateImagePreview() {
  const { brightness, contrast } = adjustState;
  let cssFilter = "";

  if (brightness !== 0 || contrast !== 0) {
    const b = 100 + brightness;
    const c = 100 + contrast;
    cssFilter = `brightness(${b}%) contrast(${c}%)`;
  }

  $img.style.filter = cssFilter;
  syncPreviewImagePresentation();

  if (!shouldRenderAdjustPreview(adjustState)) {
    if (previewThrottleTimer) clearTimeout(previewThrottleTimer);
    hideAdjustPreview();
    return;
  }

  if (previewThrottleTimer) clearTimeout(previewThrottleTimer);
  previewThrottleTimer = setTimeout(() => {
    updateAdjustPreviewCanvas();
  }, 150);
}

let previewImg = null;

async function updateAdjustPreviewCanvas() {
  if (images.length === 0) return;
  if ($img.naturalWidth === 0) return;

  const pw = $img.naturalWidth;
  const ph = $img.naturalHeight;

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = pw;
  previewCanvas.height = ph;
  const pctx = previewCanvas.getContext("2d");
  pctx.drawImage($img, 0, 0, pw, ph);

  if (adjustState.activeFilter !== "none") {
    const imageData = pctx.getImageData(0, 0, pw, ph);
    applyFilter(imageData, adjustState.activeFilter);
    pctx.putImageData(imageData, 0, 0);
  }

  const blob = await new Promise((res) => previewCanvas.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);

  if (!previewImg) {
    previewImg = new Image();
  }

  syncPreviewImagePresentation();

  previewImg.onload = () => {
    $loadingOverlay.classList.add("hidden");
    $img.style.visibility = "hidden";
    if (previewImg.parentElement !== $viewer) {
      $viewer.appendChild(previewImg);
    }
    previewImg.style.visibility = "visible";
  };

  previewImg.src = url;
}

function hideAdjustPreview() {
  $loadingOverlay.classList.add("hidden");
  if (previewImg) {
    previewImg.onload = null;
    previewImg.style.visibility = "hidden";
    $img.style.visibility = "visible";
  }
}

function updateAdjustUI() {
  document.querySelectorAll(".filter-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === adjustState.activeFilter);
  });

  updateImagePreview();
}

// Filter application
function applyFilter(imageData, filterName) {
  const data = imageData.data;

  switch (filterName) {
    case "grayscale":
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = gray;
      }
      break;
    case "warm":
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] * 1.1);
        data[i + 2] = Math.max(0, data[i + 2] * 0.9);
      }
      break;
    case "cool":
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, data[i] * 0.9);
        data[i + 2] = Math.min(255, data[i + 2] * 1.1);
      }
      break;
    case "vintage":
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] * 1.0 + 20);
        data[i + 1] = Math.min(255, data[i + 1] * 0.9 + 10);
        data[i + 2] = Math.min(255, data[i + 2] * 0.8 + 20);
      }
      break;
    case "vivid":
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        for (let c = 0; c < 3; c++) {
          data[i + c] = Math.max(
            0,
            Math.min(255, data[i + c] * 1.2 + (data[i + c] - lum) * 0.3)
          );
        }
      }
      break;
  }
}

// Filter selection
document.querySelectorAll(".filter-item").forEach((item) => {
  item.addEventListener("click", () => {
    adjustState.activeFilter = item.dataset.filter;
    $loadingOverlay.querySelector("p").textContent = "处理中...";
    $loadingOverlay.classList.remove("hidden");
    updateAdjustUI();
    if (adjustState.activeFilter !== "none") {
      hasChanges = true;
      updateSaveButtonState();
    }
  });
});
