const VOLUME_STEP = 0.05;

export function buildFullscreenController(fullscreenRuntime) {
  return {
    async toggle() {
      if (!fullscreenRuntime) {
        return false;
      }

      const isFullscreen = await fullscreenRuntime.isFullscreen();
      if (isFullscreen) {
        await fullscreenRuntime.exitFullscreen();
        return false;
      }

      await fullscreenRuntime.enterFullscreen();
      return true;
    },
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return [hours, minutes, secs]
      .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
      .join(":");
  }

  return [minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function clampVolume(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(value, 0), 1);
}

export function getFileNameFromPath(filePath) {
  if (!filePath) {
    return "";
  }

  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return decodeURIComponent(segments[segments.length - 1] || "");
}

function isEditableTarget(target) {
  if (!target || target === document.body) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    tagName === "BUTTON"
  );
}

export function buildMediaURL(filePath) {
  return `/local-media?path=${encodeURIComponent(filePath)}`;
}

export function shouldToggleWindowFullscreenOnDoubleClick(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  if (target.closest(".svp-controls, .svp-empty-state, .svp-btn-fullscreen")) {
    return false;
  }

  return Boolean(target.closest(".svp-player"));
}

export function createDoubleClickGuard({
  scheduler = (callback) => globalThis.setTimeout(callback, 220),
  cancelScheduler = (timerId) => globalThis.clearTimeout(timerId),
  onSingleClick,
  onDoubleClick,
} = {}) {
  let clickTimer = 0;

  return {
    handleClick(event) {
      if (!event?.isTrusted || typeof onSingleClick !== "function") {
        return false;
      }

      if (clickTimer) {
        cancelScheduler(clickTimer);
      }

      clickTimer = scheduler(() => {
        clickTimer = 0;
        onSingleClick(event.target);
      });

      return true;
    },
    handleDoubleClick(event) {
      if (clickTimer) {
        cancelScheduler(clickTimer);
        clickTimer = 0;
      }

      if (typeof onDoubleClick === "function") {
        onDoubleClick(event.target);
      }
    },
  };
}

export function dispatchSelectionState(video, hasSelection, isLoading = false) {
  if (!video || typeof video.dispatchEvent !== "function" || typeof CustomEvent !== "function") {
    return;
  }

  video.dispatchEvent(
    new CustomEvent("svp:selection-state", {
      bubbles: true,
      detail: {
        hasSelection: Boolean(hasSelection),
        isLoading: Boolean(isLoading),
      },
    }),
  );
}

export function syncExternalSelectionState(video, hasSelection, isLoading = false) {
  if (!video || typeof video.closest !== "function") {
    return;
  }

  const wrapper = video.closest(".svp-player");
  if (!wrapper) {
    return;
  }

  wrapper.classList.toggle("svp-empty", !hasSelection);
  wrapper.classList.toggle("svp-ready", Boolean(hasSelection) && !isLoading);

  if (hasSelection) {
    wrapper.classList.remove("svp-idle", "svp-fullscreen-idle");
  } else {
    wrapper.classList.add("svp-show-center-icon");
  }

  const stopButton = wrapper.querySelector(".svp-btn-stop");
  if (stopButton) {
    stopButton.disabled = !hasSelection;
  }

  const titleNode = wrapper.querySelector(".svp-title");
  if (titleNode) {
    const title = hasSelection ? video.dataset?.svpLocalFileName || "" : "";
    titleNode.textContent = title;
    wrapper.classList.toggle("svp-has-title", Boolean(title));
  }
}

export function scheduleExternalSelectionStateSync(
  video,
  hasSelection,
  isLoading = false,
  scheduler = (callback) => globalThis.setTimeout(callback, 0),
  sync = syncExternalSelectionState,
) {
  scheduler(() => {
    sync(video, hasSelection, isLoading);
  });
}

async function defaultOpenVideoFile() {
  const openVideoFile = globalThis?.go?.main?.App?.OpenVideoFile;

  if (typeof openVideoFile !== "function") {
    throw new Error("当前运行环境未注入 Wails 文件选择接口");
  }

  return openVideoFile();
}

async function defaultGetVideoDuration(filePath) {
  const getVideoDuration = globalThis?.go?.main?.App?.GetVideoDuration;

  if (typeof getVideoDuration !== "function") {
    return 0;
  }

  return getVideoDuration(filePath);
}

export function createMarkup() {
  return `
    <main class="app-shell">
      <div class="app-status" data-status></div>
      <div class="player-host">
        <video class="video-player" preload="metadata"></video>
      </div>
    </main>
  `;
}

function attachShortcutHandlers(video, statusNode, fullscreenController, syncWindowFullscreenClass) {
  document.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      video.muted = false;
      video.volume = clampVolume(video.volume + VOLUME_STEP);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextVolume = clampVolume(video.volume - VOLUME_STEP);
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
      return;
    }

    if (event.key.toLowerCase() === "f" && fullscreenController) {
      event.preventDefault();
      fullscreenController
        .toggle()
        .then(syncWindowFullscreenClass)
        .catch(() => {
          statusNode.textContent = "当前平台不支持退出全屏。";
        });
    }
  });
}

export function initPlayerApp({
  root = document.querySelector("#app"),
  openVideoFile = defaultOpenVideoFile,
  getVideoDuration = defaultGetVideoDuration,
  fullscreenRuntime = null,
} = {}) {
  if (!root) {
    throw new Error("缺少播放器挂载节点");
  }

  root.innerHTML = createMarkup();

  const video = root.querySelector("video");
  const statusNode = root.querySelector("[data-status]");
  const fullscreenController = buildFullscreenController(fullscreenRuntime);
  const doubleClickGuard = createDoubleClickGuard({
    onSingleClick(target) {
      if (!target || typeof target.dispatchEvent !== "function") {
        return;
      }

      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    onDoubleClick(target) {
      if (!fullscreenRuntime || !shouldToggleWindowFullscreenOnDoubleClick(target)) {
        return;
      }

      fullscreenController
        .toggle()
        .then(syncWindowFullscreenClass)
        .catch(() => {
          showStatus("当前平台不支持窗口全屏。");
        });
    },
  });

  video.playsInline = true;

  const clearStatus = () => {
    statusNode.textContent = "";
  };

  const showStatus = (message) => {
    statusNode.textContent = message;
  };

  const syncWindowFullscreenClass = async () => {
    const wrapper = video.closest(".svp-player");
    if (!wrapper || !fullscreenRuntime) {
      return;
    }

    try {
      const isFullscreen = await fullscreenRuntime.isFullscreen();
      wrapper.classList.toggle("window-fullscreen", Boolean(isFullscreen));
    } catch (_error) {
      wrapper.classList.remove("window-fullscreen");
    }
  };

  const applyVideoFile = async (filePath) => {
    if (!filePath) {
      return;
    }

    clearStatus();
    video.dataset.svpLocalFileName = getFileNameFromPath(filePath);
    try {
      const duration = await getVideoDuration(filePath);
      if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
        video.dataset.svpExpectedDuration = String(Number(duration));
      } else {
        delete video.dataset.svpExpectedDuration;
      }
    } catch (_error) {
      delete video.dataset.svpExpectedDuration;
    }
    video.src = buildMediaURL(filePath);
    dispatchSelectionState(video, true, true);
    scheduleExternalSelectionStateSync(video, true, true);
    video.load();

    try {
      await video.play();
      scheduleExternalSelectionStateSync(video, true, true);
    } catch (_error) {
      scheduleExternalSelectionStateSync(video, true, false);
      showStatus("文件已加载，但当前平台阻止自动播放，请点击播放器开始播放。");
    }
  };

  const handleOpenFile = async () => {
    try {
      const filePath = await openVideoFile();
      await applyVideoFile(filePath);
    } catch (error) {
      showStatus(error?.message || "打开文件失败，请重试。");
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      if (event.isTrusted && shouldToggleWindowFullscreenOnDoubleClick(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        doubleClickGuard.handleClick(event);
        return;
      }

      const openTarget = event.target.closest(".svp-open-local-btn");
      if (!openTarget) {
      } else {
        event.preventDefault();
        event.stopPropagation();
        handleOpenFile();
        return;
      }

      const fullscreenTarget = event.target.closest(".svp-btn-fullscreen");
      if (!fullscreenTarget || !fullscreenRuntime) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      fullscreenController
        .toggle()
        .then(syncWindowFullscreenClass)
        .catch(() => {
          showStatus("当前平台不支持窗口全屏。");
        });
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      if (!fullscreenRuntime || !shouldToggleWindowFullscreenOnDoubleClick(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      doubleClickGuard.handleDoubleClick(event);
    },
    true,
  );

  video.addEventListener("loadstart", () => {
    clearStatus();
    scheduleExternalSelectionStateSync(video, true, true);
  });
  video.addEventListener("loadedmetadata", () => {
    dispatchSelectionState(video, true, false);
    scheduleExternalSelectionStateSync(video, true, false);
    clearStatus();
  });
  video.addEventListener("play", () => {
    scheduleExternalSelectionStateSync(video, true, false);
  });
  video.addEventListener("pause", () => {
    if (video.currentSrc || video.getAttribute("src")) {
      scheduleExternalSelectionStateSync(video, true, false);
    }
  });
  video.addEventListener("error", () => {
    dispatchSelectionState(video, false, false);
    scheduleExternalSelectionStateSync(video, false, false);
    delete video.dataset.svpExpectedDuration;
    showStatus("当前文件无法播放，请重新选择其他视频。");
  });

  attachShortcutHandlers(video, statusNode, fullscreenRuntime ? fullscreenController : null, syncWindowFullscreenClass);
  syncWindowFullscreenClass();

  return {
    video,
    open: handleOpenFile,
  };
}
