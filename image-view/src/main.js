import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { shouldHandleGlobalHotkey } from "./hotkeys.js";
import { quantizeImageData } from "./image-quantize.js";

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

let images = [];
let currentIndex = -1;
let scale = 1;
let rotation = 0;
let hasChanges = false;
let isCropping = false;
let cropRegion = null;
let cropStart = null;
let tempCrop = null;
let currentCropRatio = 0; // 0 means free ratio
let isAdjusting = false;

// 调整状态
let adjustState = {
  brightness: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  activeFilter: 'none'
};

// 图片拖动相关
let isDraggingImage = false;
let imageDragStart = { x: 0, y: 0 };
let imageOffset = { x: 0, y: 0 }; // 当前图片的偏移量
let imageScale = 1; // 当前图片的缩放
let originalWidth = 0; // 原图宽度
let originalHeight = 0; // 原图高度
let initialWidth = 0; // 初始原图宽度（不受缩放影响）
let initialHeight = 0; // 初始原图高度（不受缩放影响）
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "heic", "heif", "tif", "tiff"]);

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function convertAndSaveImageFromContextMenu(options = {}) {
  hideContextMenu();
  $loadingOverlay.classList.remove("hidden");
  await waitForNextPaint();
  await convertAndSaveImage(false, options);
}

function updateTransform() {
  $img.style.transform = `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${scale}) rotate(${rotation}deg)`;
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

  // 记录原图尺寸
  originalWidth = $img.naturalWidth;
  originalHeight = $img.naturalHeight;

  // 如果有输入框获得焦点,不更新值
  if (document.activeElement === $sizeWidth || document.activeElement === $sizeHeight) {
    return;
  }

  $sizeWidth.value = originalWidth;
  $sizeHeight.value = originalHeight;

  // max 以 initialWidth 为上限,因为每次缩放都从原图重新缩放
  $sizeWidth.max = initialWidth > 0 ? initialWidth : originalWidth;
  $sizeHeight.max = initialHeight > 0 ? initialHeight : originalHeight;

  $imageSize.classList.add("show");
}

// 设置初始宽高（仅在首次加载时设置,后续不更新）
function setInitialSize() {
  if (initialWidth === 0 && initialHeight === 0) {
    initialWidth = $img.naturalWidth;
    initialHeight = $img.naturalHeight;
  }
}

// 恢复输入框到初始值
function resetSizeInputs() {
  if (initialWidth === 0 || initialHeight === 0) return;
  $sizeWidth.value = initialWidth;
  $sizeHeight.value = initialHeight;
}

function revokeCurrentSrc() {
  if ($img.src && $img.src.startsWith("blob:")) {
    URL.revokeObjectURL($img.src);
  }
}

async function readImage(path) {
  const bytes = await invoke("read_image", { path });
  const blob = new Blob([new Uint8Array(bytes)]);
  return URL.createObjectURL(blob);
}

async function showImage(index) {
  if (images.length === 0) return;
  if (index < 0) index = images.length - 1;
  if (index >= images.length) index = 0;

  const prevIndex = currentIndex;
  currentIndex = index;
  scale = 1;
  imageScale = 1;
  imageOffset = { x: 0, y: 0 };
  rotation = 0;
  hasChanges = false;
  cropRegion = null;
  adjustState = {
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    activeFilter: "none"
  };
  hideCropRect();
  exitCropMode();
  closeAdjustPanel();
  hideAdjustPreview();
  updateTransform();
  $img.style.filter = "";
  $img.style.visibility = "visible";

  let newUrl;
  try {
    newUrl = await readImage(images[currentIndex]);
  } catch (e) {
    console.error("[showImage] failed to read image:", e);
    // 图片被删除，从数组中移除，然后调整 currentIndex 跳过它
    const failedIndex = currentIndex;
    images.splice(failedIndex, 1);
    // 调整 currentIndex 到有效位置（跳过被删除的图片）
    if (images.length === 0) {
      // 没有图片了
      currentIndex = -1;
    } else if (failedIndex >= images.length) {
      // 删除的是最后一张，现在指向最后一张
      currentIndex = images.length - 1;
    } else {
      // 删除的是中间的图片，currentIndex 保持为 failedIndex（现在是下一张图片）
      currentIndex = failedIndex;
    }
    // 清除旧图片并隐藏
    $img.src = "";
    $img.style.visibility = "hidden";
    // 隐藏左上角的名字
    $info.classList.remove("show");
    $info.textContent = "";
    $errorOverlay.classList.remove("hidden");
    return;
  }

  // 只有成功读取后才清除旧图片
  revokeCurrentSrc();
  $img.src = newUrl;
  setInitialSize();
  updateAdjustUI();

  // 等待图片加载完成以获取正确的尺寸
  await new Promise((resolve) => {
    if ($img.complete && $img.naturalWidth > 0) {
      resolve();
    } else {
      $img.onload = () => {
        updateImageSize();
        resolve();
      };
      $img.onerror = () => {
        // 图片加载失败（损坏或文件被删除），从数组中移除
        const failedIndex = currentIndex;
        // images.splice(failedIndex, 1);
        // 调整 currentIndex 到有效位置（跳过被删除的图片）
        if (images.length === 0) {
          currentIndex = -1;
        } else if (failedIndex >= images.length) {
          currentIndex = images.length - 1;
        } else {
          currentIndex = failedIndex;
        }
        // 清除图片并隐藏
        $img.src = "";
        $img.style.visibility = "hidden";
        // 隐藏左上角的名字
        $info.classList.remove("show");
        $info.textContent = "";
        $errorOverlay.classList.remove("hidden");
        resolve();
      };
    }
  });

  $overlay.classList.remove("show");
  $errorOverlay.classList.add("hidden");
  updateInfo();
  updateImageSize();
  setInitialSize();
  updateSaveButtonState();
  updateToolbarVisibility();
  updateOverlayHint();
}

async function loadDir(dirPath) {
  try {
    const list = await invoke("list_images", { dir: dirPath });
    if (!list || list.length === 0) {
      alert("该目录下没有找到支持的图片文件");
      return;
    }
    images = list;
    await showImage(0);
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
  const isDir = await invoke("is_dir", { path });
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
  const list = await invoke("list_images", { dir });
  if (!list || list.length === 0) {
    alert("该目录下没有找到支持的图片文件");
    return;
  }

  images = list;
  const targetIndex = list.findIndex((item) => normalizePath(item) === normalizePath(path));
  await showImage(targetIndex >= 0 ? targetIndex : 0);
}

async function openIncomingPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return;
  const candidate = paths.find((item) => typeof item === "string" && (isImagePath(item) || item.length > 0));
  if (!candidate) return;

  try {
    await loadPath(candidate);
  } catch (e) {
    console.error("openIncomingPaths failed", e);
    alert("打开文件失败: " + e);
  }
}

async function openImage() {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "heic", "heif", "tif", "tiff"],
      },
    ],
  });
  if (!selected) return;
  // selected can be a string or an array of strings
  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length > 0) {
    await openIncomingPaths(paths);
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
  updateTransform();
  hasChanges = true;
  updateSaveButtonState();
}

async function resetView() {
  scale = 1;
  imageOffset = { x: 0, y: 0 };
  rotation = 0;
  adjustState = {
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    activeFilter: "none"
  };
  updateTransform();
  cropRegion = null;
  hideCropRect();
  exitCropMode();
  closeAdjustPanel();
  resetSizeInputs();

  // 先重新加载原图，确保显示的是原始图片
  if (images.length > 0) {
    revokeCurrentSrc();
    const url = await readImage(images[currentIndex]);
    $img.src = url;
  }

  // 然后隐藏预览，恢复状态
  hideAdjustPreview();
  $img.style.filter = "";
  $img.style.visibility = "visible";
  hasChanges = false;
  updateSaveButtonState();
  updateAdjustUI();
}

function zoom(delta) {
  if (images.length === 0) return;
  scale = Math.min(Math.max(scale + delta, 0.1), 10);
  updateTransform();
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

  console.log("[getEditedCanvas] start, adjustState:", JSON.stringify(adjustState));

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

  // 应用调整效果
  if (adjustState.brightness !== 0 || adjustState.contrast !== 0) {
    console.log("[getEditedCanvas] applying brightness/contrast");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyBrightnessContrast(imageData, adjustState.brightness, adjustState.contrast);
    ctx.putImageData(imageData, 0, 0);
  }

  if (adjustState.shadows !== 0 || adjustState.highlights !== 0) {
    console.log("[getEditedCanvas] applying shadows/highlights:", adjustState.shadows, adjustState.highlights);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyShadowsHighlights(imageData, adjustState.shadows, adjustState.highlights);
    ctx.putImageData(imageData, 0, 0);
  }

  if (adjustState.activeFilter !== "none") {
    console.log("[getEditedCanvas] applying filter:", adjustState.activeFilter);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyFilter(imageData, adjustState.activeFilter);
    ctx.putImageData(imageData, 0, 0);
  }

  console.log("[getEditedCanvas] done");
  return canvas;
}

async function saveImage() {
  if (images.length === 0) return;

  console.log("[saveImage] start, hasChanges:", hasChanges, "currentIndex:", currentIndex);

  let canvas = await getEditedCanvas();
  if (!canvas) {
    console.warn("[saveImage] getEditedCanvas returned null");
    return;
  }

  if (cropRegion) {
    canvas = await applyCropToCanvas(canvas);
    cropRegion = null;
    hideCropRect();
    exitCropMode();
  }

  const mime = getMimeType(images[currentIndex]);
  const quality = mime === "image/jpeg" ? 0.95 : undefined;
  const blob = await new Promise((res) => canvas.toBlob(res, mime, quality));
  const buf = await blob.arrayBuffer();
  const data = new Uint8Array(buf);

  const ext = images[currentIndex].split(".").pop().toLowerCase();
  const fileName = images[currentIndex].split(/[/\\]/).pop();

  const filters = [
    {
      name: "Image",
      extensions: ext ? [ext] : ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
    },
  ];

  console.log("[saveImage] calling save dialog with defaultPath:", fileName);

  try {
    const savePath = await save({
      defaultPath: fileName,
      filters,
    });

    console.log("[saveImage] save dialog returned:", savePath);

    if (!savePath) {
      console.log("[saveImage] user cancelled save dialog");
      return;
    }

    console.log("[saveImage] invoking save_image with path:", savePath);
    await invoke("save_image", { path: savePath, data });
    console.log("[saveImage] save_image succeeded");
    hasChanges = false;
    rotation = 0;
    scale = 1;
    adjustState = {
      brightness: 0,
      contrast: 0,
      shadows: 0,
      highlights: 0,
      activeFilter: "none"
    };
    updateTransform();
    updateSaveButtonState();
    hideAdjustPreview();
    revokeCurrentSrc();
    const url = await readImage(images[currentIndex]);
    $img.src = url;
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

function updateCropRect(x, y, w, h) {
  $cropRect.style.left = `${x}px`;
  $cropRect.style.top = `${y}px`;
  $cropRect.style.width = `${w}px`;
  $cropRect.style.height = `${h}px`;
  $cropRect.classList.remove("hidden");

  // 显示像素值标签
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
  isCropping = true;
  $cropHint.classList.remove("hidden");
  $viewer.style.cursor = "crosshair";
}

function exitCropMode() {
  isCropping = false;
  $cropHint.classList.add("hidden");
  $viewer.style.cursor = "default";
  cropStart = null;
  tempCrop = null;
  $cropRatioMenu.classList.add("hidden");
  $cropSizeLabel.classList.add("hidden");
}

function toggleCropMode() {
  if (isCropping) {
    exitCropMode();
    cropRegion = null;
    currentCropRatio = 0;
    document.querySelectorAll(".ratio-item").forEach((el) => el.classList.remove("active"));
    hideCropRect();
    $cropRatioMenu.classList.add("hidden");
    $cropSizeLabel.classList.add("hidden");
  } else {
    enterCropMode();
    $cropRatioMenu.classList.remove("hidden");
  }
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

  cropRegion = null;
  hideCropRect();
  rotation = 0;
  scale = 1;
  imageOffset = { x: 0, y: 0 };
  updateTransform();
  hasChanges = true;
  updateSaveButtonState();
  exitCropMode();
}

// 键盘事件
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
  else if (e.key === "=" || e.key === "+") zoom(0.05);
  else if (e.key === "-" || e.key === "_") zoom(-0.05);
  else if (e.key === "c" || e.key === "C") toggleCropMode();
  else if (e.key === "Enter" && isCropping) {
    e.preventDefault();
    confirmCrop();
  } else if (e.key === "Escape" && isCropping) {
    exitCropMode();
    cropRegion = null;
    hideCropRect();
    updateSaveButtonState();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveImage();
  }
});

// 滚轮缩放 - 使用乘法因子使缩放更平滑,带节流
let lastWheelTime = 0;
const wheelThrottle = 100; // 每100ms最多触发一次

document.addEventListener("wheel", (e) => {
  if (images.length === 0) return;
  e.preventDefault();

  const now = Date.now();
  if (now - lastWheelTime < wheelThrottle) return;
  lastWheelTime = now;

  // deltaY > 0 表示向下滚动（缩小）,deltaY < 0 表示向上滚动（放大）
  // 每次滚动缩放 8%
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  scale = Math.min(Math.max(scale * (1 + delta), 0.1), 10);
  updateTransform();
}, { passive: false });

// 拖拽打开
const win = getCurrentWindow();
win.onDragDropEvent((event) => {
  if (event.payload.type === "drop") {
    const paths = event.payload.paths;
    if (paths && paths.length > 0) {
      openIncomingPaths(paths);
    }
  }
});

// 初始化界面状态（无图片时隐藏工具栏和F11提示）
updateToolbarVisibility();
updateOverlayHint();

// 双击放大/恢复
$img.addEventListener("dblclick", toggleZoom);

// 裁剪鼠标事件
let isDraggingCrop = false;
let dragOffset = { x: 0, y: 0 };

$viewer.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;

  const viewerRect = $viewer.getBoundingClientRect();
  const mouseX = e.clientX - viewerRect.left;
  const mouseY = e.clientY - viewerRect.top;

  // 如果在裁剪模式
  if (isCropping) {
    // 检查是否点击在裁剪框内（如果是,则拖动整个框）
    if (cropRegion) {
      const { x, y, width, height } = cropRegion;
      if (mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height) {
        isDraggingCrop = true;
        dragOffset = { x: mouseX - x, y: mouseY - y };
        cropStart = null;
        e.stopPropagation();
        return;
      }
    }
    // 否则开始绘制新的裁剪区域
    cropStart = { x: mouseX, y: mouseY };
    isDraggingCrop = false;
    return;
  }

  // 非裁剪模式：检查是否点击在图片上,如果是则启动图片拖动
  const imgRect = $img.getBoundingClientRect();
  if (mouseX >= imgRect.left - viewerRect.left && mouseX <= imgRect.right - viewerRect.left &&
      mouseY >= imgRect.top - viewerRect.top && mouseY <= imgRect.bottom - viewerRect.top) {
    isDraggingImage = true;
    imageDragStart = { x: mouseX, y: mouseY };
    $img.classList.add("dragging");
  }
});

window.addEventListener("mousemove", (e) => {
  const viewerRect = $viewer.getBoundingClientRect();
  const imgRect = $img.getBoundingClientRect();

  const imgLeft = imgRect.left - viewerRect.left;
  const imgTop = imgRect.top - viewerRect.top;
  const imgRight = imgLeft + imgRect.width;
  const imgBottom = imgTop + imgRect.height;

  let cx = e.clientX - viewerRect.left;
  let cy = e.clientY - viewerRect.top;

  // 如果正在拖动图片
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

  // 如果不在裁剪模式,不处理裁剪相关逻辑
  if (!isCropping) return;

  // 如果正在拖动裁剪框
  if (isDraggingCrop && cropRegion) {
    let newX = cx - dragOffset.x;
    let newY = cy - dragOffset.y;

    // 确保不超出边界
    if (newX < imgLeft) { newX = imgLeft; }
    if (newY < imgTop) { newY = imgTop; }
    if (newX + cropRegion.width > imgRight) { newX = imgRight - cropRegion.width; }
    if (newY + cropRegion.height > imgBottom) { newY = imgBottom - cropRegion.height; }

    cropRegion.x = newX;
    cropRegion.y = newY;
    updateCropRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
    $btnSave.disabled = false;
    return;
  }

  if (!cropStart) return;

  cx = Math.max(imgLeft, Math.min(imgRight, cx));
  cy = Math.max(imgTop, Math.min(imgBottom, cy));

  cx = Math.max(imgLeft, Math.min(imgRight, cx));
  cy = Math.max(imgTop, Math.min(imgBottom, cy));

  const startX = Math.max(imgLeft, Math.min(imgRight, cropStart.x));
  const startY = Math.max(imgTop, Math.min(imgBottom, cropStart.y));

  let x = Math.min(startX, cx);
  let y = Math.min(startY, cy);
  let w = Math.abs(cx - startX);
  let h = Math.abs(cy - startY);

  // 如果有比例约束,调整尺寸以保持比例
  if (currentCropRatio > 0) {
    if (w > h * currentCropRatio) {
      w = h * currentCropRatio;
      if (cx < cropStart.x) x = cropStart.x - w;
    } else {
      h = w / currentCropRatio;
      if (cy < cropStart.y) y = cropStart.y - h;
    }
    // 确保不超出图片边界
    if (x < imgLeft) { x = imgLeft; }
    if (y < imgTop) { y = imgTop; }
    if (x + w > imgRight) { w = imgRight - x; h = w / currentCropRatio; }
    if (y + h > imgBottom) { h = imgBottom - y; w = h * currentCropRatio; }
  }

  updateCropRect(x, y, w, h);
  tempCrop = { x, y, width: w, height: h };

  // 裁剪过程中也启用保存按钮
  if (tempCrop && tempCrop.width > 2 && tempCrop.height > 2) {
    $btnSave.disabled = false;
  }
});

window.addEventListener("mouseup", () => {
  // 结束图片拖动
  if (isDraggingImage) {
    isDraggingImage = false;
    $img.classList.remove("dragging");
    return;
  }

  if (!isCropping) return;
  if (isDraggingCrop) {
    isDraggingCrop = false;
    return;
  }
  cropStart = null;
  if (tempCrop && tempCrop.width > 2 && tempCrop.height > 2) {
    cropRegion = tempCrop;
  }
  tempCrop = null;
});

// 右键菜单
function showContextMenu(e) {
  e.preventDefault();
  if (images.length === 0) return;

  hideAllSubmenus();

  // 始终显示转为 JPG 和转为 PNG 两个选项
  // PNG 图片隐藏"原始颜色"选项（因为PNG本身已经无损）
  const originalColorItem = $pngColorSubmenu.querySelector('[data-colors="0"]');
  if (originalColorItem) {
    originalColorItem.style.display = "none";
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

// 拷贝图片
async function copyImage() {
  hideContextMenu();
  if (images.length === 0) return;

  console.log("[copyImage] starting, path:", images[currentIndex]);
  try {
    // 如果有裁剪区域或旋转,先保存临时文件再拷贝
    if (cropRegion || rotation !== 0) {
      console.log("[copyImage] has crop or rotation, saving temp file");

      let canvas = await getEditedCanvas();
      if (!canvas) return;

      if (cropRegion) {
        canvas = await applyCropToCanvas(canvas);
      }

      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const buf = await blob.arrayBuffer();
      const data = new Uint8Array(buf);

      // 保存到临时目录
      const tmpPath = `/tmp/cropped_image_${Date.now()}.png`;
      await invoke("save_image", { path: tmpPath, data });
      console.log("[copyImage] saved temp file:", tmpPath);

      // 调用Rust命令拷贝到剪贴板
      await invoke("copy_image_to_clipboard", { path: tmpPath });
      console.log("[copyImage] copied to clipboard via rust");
    } else {
      // 没有裁剪和旋转,直接拷贝原文件
      await invoke("copy_image_to_clipboard", { path: images[currentIndex] });
      console.log("[copyImage] copied original file to clipboard");
    }

    console.log("[copyImage] success");
  } catch (e) {
    console.error("[copyImage] failed:", e);
    alert("拷贝图片失败: " + (e?.message || e));
  }
}

// 分享图片
async function shareImage() {
  hideContextMenu();
  if (images.length === 0) return;

  try {
    const canvas = await getEditedCanvas();
    if (!canvas) return;

    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const file = new File([blob], "image.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      // Fallback: 打开另存对话框
      await convertAndSaveImage(true);
    }
  } catch (e) {
    console.error("shareImage failed:", e);
    if (e.name !== "AbortError") {
      alert("分享失败");
    }
  }
}

// 格式转换并保存
async function convertAndSaveImage(isShare = false, options = {}) {
  if (images.length === 0) return;

  try {
    const { quality, colors, targetMime: optTargetMime, targetExt: optTargetExt } = options;

    // 如果调用时明确指定了目标格式,使用指定格式；否则根据原图扩展名判断
    let targetMime = optTargetMime;
    let targetExt = optTargetExt;

    if (!targetMime || !targetExt) {
      const ext = images[currentIndex].split(".").pop()?.toLowerCase();
      const isJpg = ext === "jpg" || ext === "jpeg";
      targetMime = isJpg ? "image/png" : "image/jpeg";
      targetExt = isJpg ? "png" : "jpg";
    }

    // Determine quality: if explicitly set, use it; if converting to JPG, default to 0.95
    let targetQuality;
    if (quality !== undefined) {
      targetQuality = quality;
    } else {
      targetQuality = targetMime === "image/jpeg" ? 0.95 : undefined;
    }

    const canvas = await getEditedCanvas();
    if (!canvas) return;

    // Handle PNG color quantization
    let finalCanvas = canvas;
    let indexedPngBytes = null;
    if (colors !== undefined && colors > 0 && targetMime === "image/png") {
      finalCanvas = await convertToColorPalette(canvas, colors, true);
      const ctx = finalCanvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
      try {
        indexedPngBytes = await invoke("encode_indexed_png", {
          data: Array.from(imageData.data),
          width: finalCanvas.width,
          height: finalCanvas.height,
        });
      } catch (e) {
        console.warn("encode_indexed_png failed, fallback to regular PNG encoding", e);
        indexedPngBytes = null;
      }
    }

    const blob = await new Promise((res) => finalCanvas.toBlob(res, targetMime, targetQuality));
    const buf = await blob.arrayBuffer();
    const data = new Uint8Array(buf);

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

    const filters = [{ name: "Image", extensions: [targetExt] }];

    const savePath = await save({ defaultPath: fileName, filters });
    if (!savePath) return;

    if (indexedPngBytes && targetMime === "image/png") {
      await invoke("save_image", { path: savePath, data: indexedPngBytes });
    } else {
      await invoke("save_image", { path: savePath, data });
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

  // 0 means keep original colors
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
  // 可保存条件：图片旋转非360度的倍数（90、180、270）、或选择了裁剪区域、或已确认过裁剪
  const canSave = (rotation % 360 !== 0) || (cropRegion !== null) || hasChanges;
  $btnSave.disabled = !canSave;
}

// 右键菜单事件
$ctxCopy.addEventListener("click", copyImage);
$ctxShare.addEventListener("click", shareImage);

// 格式转换子菜单 - hover时显示子菜单
$ctxToJpg.addEventListener("mouseenter", (e) => {
  hideAllSubmenus();
  $jpgQualitySubmenu.classList.remove("hidden");
});

$ctxToPng.addEventListener("mouseenter", (e) => {
  hideAllSubmenus();
  $pngColorSubmenu.classList.remove("hidden");
});

// JPG 质量选择
$jpgQualitySubmenu.querySelectorAll(".submenu-item").forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.stopPropagation();
    const quality = parseFloat(item.dataset.quality);
    await convertAndSaveImageFromContextMenu({ quality, targetMime: "image/jpeg", targetExt: "jpg" });
  });
});

// PNG 颜色数量选择
$pngColorSubmenu.querySelectorAll(".submenu-item").forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.stopPropagation();
    const colors = parseInt(item.dataset.colors, 10);
    await convertAndSaveImageFromContextMenu({ colors, targetMime: "image/png", targetExt: "png" });
  });
});

// 工具栏事件
$btnRotate.addEventListener("click", rotateImage);
$btnCrop.addEventListener("click", toggleCropMode);
$btnAdjust.addEventListener("click", toggleAdjustPanel);
$btnSave.addEventListener("click", saveImage);
$btnReset.addEventListener("click", resetView);

// 裁剪比例选择
document.querySelectorAll(".ratio-item").forEach((item) => {
  item.addEventListener("click", () => {
    const ratio = parseFloat(item.dataset.ratio);
    currentCropRatio = ratio;

    // 更新UI选中状态
    document.querySelectorAll(".ratio-item").forEach((el) => el.classList.remove("active"));
    if (ratio > 0) {
      item.classList.add("active");
    }

    // 如果当前已有裁剪区域,应用新比例
    if (cropRegion && ratio > 0) {
      const viewerRect = $viewer.getBoundingClientRect();
      const imgRect = $img.getBoundingClientRect();
      const imgLeft = imgRect.left - viewerRect.left;
      const imgTop = imgRect.top - viewerRect.top;

      const centerX = cropRegion.x + cropRegion.width / 2;
      const centerY = cropRegion.y + cropRegion.height / 2;

      // 保持中心点,调整尺寸
      let newW = cropRegion.width;
      let newH = cropRegion.height;

      if (newW > newH * ratio) {
        newW = newH * ratio;
      } else {
        newH = newW / ratio;
      }

      const newX = centerX - newW / 2;
      const newY = centerY - newH / 2;

      cropRegion = { x: newX, y: newY, width: newW, height: newH };
      updateCropRect(newX, newY, newW, newH);
    }

    // 比例选择后保持菜单显示
  });
});

// 宽高输入框失焦时,根据比例自动调整另一个值
$sizeWidth.addEventListener("blur", () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputWidth = parseInt($sizeWidth.value, 10);
  // 负数或无效值或超过初始值,恢复初始值
  if (isNaN(inputWidth) || inputWidth <= 0 || inputWidth > initialWidth) {
    resetSizeInputs();
    return;
  }
  // 按比例调整高度
  const newHeight = Math.round((inputWidth / initialWidth) * initialHeight);
  $sizeHeight.value = newHeight;
});

$sizeHeight.addEventListener("blur", () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputHeight = parseInt($sizeHeight.value, 10);
  // 负数或无效值或超过初始值,恢复初始值
  if (isNaN(inputHeight) || inputHeight <= 0 || inputHeight > initialHeight) {
    resetSizeInputs();
    return;
  }
  // 按比例调整宽度
  const newWidth = Math.round((inputHeight / initialHeight) * initialWidth);
  $sizeWidth.value = newWidth;
});

// 点击缩放按钮时执行真正的像素级缩放
$btnResize.addEventListener("click", async () => {
  if (initialWidth === 0 || initialHeight === 0) return;
  const inputWidth = parseInt($sizeWidth.value, 10);
  const inputHeight = parseInt($sizeHeight.value, 10);
  if (isNaN(inputWidth) || isNaN(inputHeight) || inputWidth <= 0 || inputHeight <= 0) {
    return;
  }

  // 若输入值等于初始值,不进行缩放
  if (inputWidth === initialWidth && inputHeight === initialHeight) {
    return;
  }

  // 以原始图片为资源进行缩放
  const newWidth = Math.min(inputWidth, initialWidth);
  const newHeight = Math.min(inputHeight, initialHeight);

  // 重新读取原始图片
  const url = await readImage(images[currentIndex]);
  const tempImg = new Image();
  await new Promise((resolve, reject) => {
    tempImg.onload = resolve;
    tempImg.onerror = reject;
    tempImg.src = url;
  });

  // 使用 canvas 真正缩放图片像素
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(tempImg, 0, 0, newWidth, newHeight);

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Failed to create blob")), "image/png");
    });
    const url = URL.createObjectURL(blob);

    // 替换当前图片
    revokeCurrentSrc();
    $img.src = url;

    // 等待图片加载完成
    await new Promise((resolve) => {
      if ($img.complete && $img.naturalWidth > 0) {
        resolve();
      } else {
        $img.onload = resolve;
      }
    });

    // 更新尺寸记录
    originalWidth = newWidth;
    originalHeight = newHeight;
    scale = 1;
    imageOffset = { x: 0, y: 0 };
    rotation = 0;
    updateTransform();
    updateImageSize();
    hasChanges = true;
    updateSaveButtonState();
  } catch (e) {
    console.error("Resize failed:", e);
  }
});

// 初始化
updateInfo();
$btnSave.disabled = true;

// 点击错误提示框关闭
$errorOverlay.addEventListener("click", () => {
  $errorOverlay.classList.add("hidden");
});

listen("open-paths", async (event) => {
  await openIncomingPaths(event.payload);
});

invoke("take_pending_open_paths")
  .then(async (paths) => {
    await openIncomingPaths(paths);
  })
  .catch((e) => {
    console.warn("take_pending_open_paths failed:", e);
  });

invoke("check_macos_security_status")
  .then((status) => {
    if (!status?.supported) return;
    if (status.allowed && !status.quarantined && !status.translocated) return;

    const reasons = [];
    if (!status.allowed) reasons.push("系统尚未明确允许该应用");
    if (status.quarantined) reasons.push("应用仍带有隔离标记");
    if (status.translocated) reasons.push("应用正在 App Translocation 临时路径运行");
    const tip = reasons.join(",");

    if (confirm(`检测到当前应用安全状态可能影响"打开方式"与文件关联：${tip}。\n是否现在打开"系统设置 > 隐私与安全性"页面？`)) {
      invoke("open_macos_security_settings").catch((e) => {
        console.warn("open_macos_security_settings failed:", e);
      });
    }
  })
  .catch((e) => {
    console.warn("check_macos_security_status failed:", e);
  });

// ========== 调整面板功能 ==========

function toggleAdjustPanel() {
  isAdjusting = !isAdjusting;
  if (isAdjusting) {
    $adjustPanel.classList.remove("hidden");
    exitCropMode();
  } else {
    $adjustPanel.classList.add("hidden");
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

  // 阴影/高光/滤镜需要 Canvas 渲染，用节流避免卡顿
  if (previewThrottleTimer) clearTimeout(previewThrottleTimer);
  previewThrottleTimer = setTimeout(() => {
    updateAdjustPreviewCanvas();
  }, 150);
}

let previewImg = null;

async function updateAdjustPreviewCanvas() {
  if (images.length === 0) return;
  if ($img.naturalWidth === 0) return;

  // 保存原始图片 URL
  const originalSrc = $img.src.startsWith("blob:") ? null : $img.src;

  // 创建缩略图预览（最大 600px）
  const pw = $img.naturalWidth;
  const ph = $img.naturalHeight;

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = pw;
  previewCanvas.height = ph;
  const pctx = previewCanvas.getContext("2d");
  pctx.drawImage($img, 0, 0, pw, ph);

  // 应用阴影/高光
  if (adjustState.shadows !== 0 || adjustState.highlights !== 0) {
    const imageData = pctx.getImageData(0, 0, pw, ph);
    applyShadowsHighlights(imageData, adjustState.shadows, adjustState.highlights);
    pctx.putImageData(imageData, 0, 0);
  }

  // 应用滤镜
  if (adjustState.activeFilter !== "none") {
    const imageData = pctx.getImageData(0, 0, pw, ph);
    applyFilter(imageData, adjustState.activeFilter);
    pctx.putImageData(imageData, 0, 0);
  }

  // 创建预览图片元素
  const blob = await new Promise((res) => previewCanvas.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);

  if (!previewImg) {
    previewImg = new Image();
  }

  // 预览图片样式：保持高糊度（因为是小图放大）
  previewImg.style.position = "absolute";
  previewImg.style.width = $img.style.width || $img.width + "px";
  previewImg.style.height = $img.style.height || $img.height + "px";
  previewImg.style.objectFit = "contain";
  previewImg.style.filter = $img.style.filter;
  previewImg.style.pointerEvents = "none";

  previewImg.onload = () => {
    // 隐藏原图，显示预览
    $img.style.visibility = "hidden";
    if (previewImg.parentElement !== $viewer) {
      $viewer.appendChild(previewImg);
    }
    previewImg.style.visibility = "visible";
  };

  previewImg.src = url;
}

// 隐藏预览，恢复原图
function hideAdjustPreview() {
  if (previewImg) {
    // 取消预览图的 onload，避免它之后覆盖 visibility 设置
    previewImg.onload = null;
    previewImg.style.visibility = "hidden";
    $img.style.visibility = "visible";
  }
}

function updateAdjustUI() {
  document.getElementById("val-brightness").textContent = adjustState.brightness;
  document.getElementById("val-contrast").textContent = adjustState.contrast;
  document.getElementById("val-shadows").textContent = adjustState.shadows;
  document.getElementById("val-highlights").textContent = adjustState.highlights;

  document.getElementById("slider-brightness").value = adjustState.brightness;
  document.getElementById("slider-contrast").value = adjustState.contrast;
  document.getElementById("slider-shadows").value = adjustState.shadows;
  document.getElementById("slider-highlights").value = adjustState.highlights;

  document.querySelectorAll(".filter-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === adjustState.activeFilter);
  });

  updateImagePreview();
}

function hasAdjustChanges() {
  return adjustState.brightness !== 0 ||
         adjustState.contrast !== 0 ||
         adjustState.shadows !== 0 ||
         adjustState.highlights !== 0 ||
         adjustState.activeFilter !== 'none';
}

// 亮度/对比度调整
function applyBrightnessContrast(imageData, brightness, contrast) {
  const data = imageData.data;
  const brightnessFactor = brightness / 100;
  const contrastFactor = (contrast + 100) / 100;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let val = data[i + c];
      // 亮度
      val += brightnessFactor * 255;
      // 对比度
      val = ((val / 255 - 0.5) * contrastFactor + 0.5) * 255;
      data[i + c] = Math.max(0, Math.min(255, val));
    }
  }
}

// 阴影/高光调整（色调分离）
function applyShadowsHighlights(imageData, shadows, highlights) {
  const data = imageData.data;
  const shadowsFactor = shadows / 50;
  const highlightsFactor = highlights / 50;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const normalizedLum = lum / 255;

    let shadowAdj = 0,
      highlightAdj = 0;

    if (normalizedLum < 0.5) {
      shadowAdj = shadowsFactor * (1 - normalizedLum * 2);
    } else {
      highlightAdj = highlightsFactor * ((normalizedLum - 0.5) * 2);
    }

    const factor = 1 + shadowAdj + highlightAdj;

    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, data[i + c] * factor));
    }
  }
}

// 滤镜应用
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

// 自动色阶
function autoTone(imageData) {
  const data = imageData.data;
  const histogram = new Array(256).fill(0);
  const pixelCount = data.length / 4;

  // 构建亮度直方图
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[lum]++;
  }

  // 找出左右裁剪点 (0.5%)
  const clipPercent = 0.5;
  const clipCount = pixelCount * (clipPercent / 100);
  let cumsum = 0;
  let minLum = 0;
  let maxLum = 255;

  for (let i = 0; i < 256; i++) {
    cumsum += histogram[i];
    if (cumsum <= clipCount) minLum = i;
  }

  cumsum = 0;
  for (let i = 255; i >= 0; i--) {
    cumsum += histogram[i];
    if (cumsum <= clipCount) maxLum = i;
  }

  // 线性拉伸
  if (maxLum > minLum) {
    const factor = 255 / (maxLum - minLum);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.max(0, Math.min(255, (data[i + c] - minLum) * factor));
      }
    }
  }
}

// 滑块事件
document.getElementById("slider-brightness").addEventListener("input", (e) => {
  adjustState.brightness = parseInt(e.target.value, 10);
  updateAdjustUI();
  markAdjustChanges();
});

document.getElementById("slider-contrast").addEventListener("input", (e) => {
  adjustState.contrast = parseInt(e.target.value, 10);
  updateAdjustUI();
  markAdjustChanges();
});

document.getElementById("slider-shadows").addEventListener("input", (e) => {
  adjustState.shadows = parseInt(e.target.value, 10);
  updateAdjustUI();
  markAdjustChanges();
});

document.getElementById("slider-highlights").addEventListener("input", (e) => {
  adjustState.highlights = parseInt(e.target.value, 10);
  updateAdjustUI();
  markAdjustChanges();
});

// 滤镜选择
document.querySelectorAll(".filter-item").forEach((item) => {
  item.addEventListener("click", () => {
    adjustState.activeFilter = item.dataset.filter;
    updateAdjustUI();
    markAdjustChanges();
  });
});

function markAdjustChanges() {
  if (hasAdjustChanges()) {
    hasChanges = true;
    updateSaveButtonState();
  }
}

// 自动色阶按钮
document.getElementById("btn-auto-tone").addEventListener("click", async () => {
  if (images.length === 0) return;

  $loadingOverlay.classList.remove("hidden");
  await waitForNextPaint();

  try {
    const canvas = await getEditedCanvas();
    if (!canvas) return;

    const imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    autoTone(imageData);
    canvas.getContext("2d").putImageData(imageData, 0, 0);

    // 显示预览
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const url = URL.createObjectURL(blob);
    revokeCurrentSrc();
    $img.src = url;
    $img.style.filter = "";

    hasChanges = true;
    updateSaveButtonState();
    closeAdjustPanel();
  } catch (e) {
    console.error("Auto tone failed:", e);
  } finally {
    $loadingOverlay.classList.add("hidden");
  }
});

// 复位按钮
document.getElementById("btn-reset-adjust").addEventListener("click", async () => {
  adjustState = {
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    activeFilter: "none"
  };
  updateAdjustUI();

  if (hasAdjustChanges() === false && $img.src && $img.src.startsWith("blob:")) {
    revokeCurrentSrc();
    const url = await readImage(images[currentIndex]);
    $img.src = url;
  }

  hasChanges = false;
  updateSaveButtonState();
});

// 点击调节按钮时,如果有调整且离开面板,恢复预览
$btnAdjust.addEventListener("click", () => {
  if (isAdjusting && hasAdjustChanges()) {
    // 重新加载原图清除预览效果
    $img.style.filter = "";
  }
});
