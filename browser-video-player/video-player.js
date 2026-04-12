(function () {
  "use strict";

  var PLAYER_FLAG = "data-svp-initialized";
  var AUTOHIDE_DELAY = 1000;
  var CENTER_ICON_DELAY = 1000;
  var SEEK_STEP = 5;
  var players = [];
  var activePlayer = null;

  function decodeFileName(value) {
    if (!value) {
      return "";
    }

    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function getTitleFromSrc(src) {
    if (!src) {
      return "";
    }

    var cleanSrc = src.split("#")[0].split("?")[0];
    var segments = cleanSrc.split("/");
    return decodeFileName(segments[segments.length - 1] || "");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }

    var total = Math.floor(seconds);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    if (hours > 0) {
      return [hours, minutes, secs]
        .map(function (part, index) {
          return index === 0 ? String(part) : String(part).padStart(2, "0");
        })
        .join(":");
    }

    return [minutes, secs]
      .map(function (part) {
        return String(part).padStart(2, "0");
      })
      .join(":");
  }

  function createIcon(path) {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      path +
      "</svg>"
    );
  }

  var icons = {
    play: createIcon('<path d="M8 5.14v13.72c0 .78.85 1.26 1.52.86l10.28-6.86a1 1 0 0 0 0-1.72L9.52 4.28A1 1 0 0 0 8 5.14Z"/>'),
    pause: createIcon('<path d="M7 5.5A1.5 1.5 0 0 1 8.5 4h1A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20h-1A1.5 1.5 0 0 1 7 18.5v-13Zm6 0A1.5 1.5 0 0 1 14.5 4h1A1.5 1.5 0 0 1 17 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 13 18.5v-13Z"/>'),
    volume: createIcon('<path d="M5 9.5A1.5 1.5 0 0 1 6.5 8H9l4.2-3.36A1 1 0 0 1 14.8 5v14a1 1 0 0 1-1.6.78L9 16H6.5A1.5 1.5 0 0 1 5 14.5v-5Zm11.53-2.7a1 1 0 1 1 1.4-1.42 9 9 0 0 1 0 12.72 1 1 0 1 1-1.4-1.42 7 7 0 0 0 0-9.88Zm-2.82 2.82a1 1 0 0 1 1.42-1.42 5 5 0 0 1 0 7.08 1 1 0 0 1-1.42-1.42 3 3 0 0 0 0-4.24Z"/>'),
    muted: createIcon('<path d="M5 9.5A1.5 1.5 0 0 1 6.5 8H9l4.2-3.36A1 1 0 0 1 14.8 5v14a1 1 0 0 1-1.6.78L9 16H6.5A1.5 1.5 0 0 1 5 14.5v-5Zm11.79-.2a1 1 0 0 1 0 1.41L15.5 12l1.29 1.29a1 1 0 0 1-1.42 1.41L14.08 13.4l-1.29 1.3a1 1 0 0 1-1.41-1.42l1.29-1.29-1.29-1.29a1 1 0 0 1 1.41-1.42l1.3 1.3 1.28-1.3a1 1 0 0 1 1.42 0Z"/>'),
    file: createIcon('<path d="M6.75 3A1.75 1.75 0 0 0 5 4.75v14.5C5 20.22 5.78 21 6.75 21h10.5c.97 0 1.75-.78 1.75-1.75V8.56c0-.46-.18-.9-.5-1.22l-4.84-4.84A1.72 1.72 0 0 0 12.44 2H6.75Zm5 1.75v3.5c0 .97.78 1.75 1.75 1.75H17.25v9.25H6.75V4.75h5Zm1.75.5 3.25 3.25H13.5V5.25Zm-4 7.25a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Zm0 3a.75.75 0 0 0 0 1.5h3.25a.75.75 0 0 0 0-1.5H9.5Z"/>'),
    speed: createIcon('<path d="M5.5 6A1.5 1.5 0 0 0 4 7.5v9A1.5 1.5 0 0 0 5.5 18h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 18.5 6h-13Zm2.8 3.12a1 1 0 0 1 1.4 0L12 11.42l2.3-2.3a1 1 0 1 1 1.4 1.42L13.42 12l2.28 2.3a1 1 0 0 1-1.4 1.4L12 13.42l-2.3 2.28a1 1 0 1 1-1.4-1.4L10.58 12 8.3 9.7a1 1 0 0 1 0-1.42Z"/>'),
    fullscreen: createIcon('<path d="M4 9V5a1 1 0 0 1 1-1h4v2H6v3H4Zm10-5h5a1 1 0 0 1 1 1v4h-2V6h-4V4ZM4 15h2v3h3v2H5a1 1 0 0 1-1-1v-4Zm14 0h2v4a1 1 0 0 1-1 1h-5v-2h4v-3Z"/>'),
    exitFullscreen: createIcon('<path d="M9 4v2H6v3H4V5a1 1 0 0 1 1-1h4Zm9 0a1 1 0 0 1 1 1v4h-2V6h-3V4h4ZM4 14h2v3h3v2H5a1 1 0 0 1-1-1v-4Zm13 0h2v4a1 1 0 0 1-1 1h-4v-2h3v-3Z"/>')
  };

  function setActivePlayer(playerApi) {
    activePlayer = playerApi;
  }

  function getCurrentPlayer() {
    if (document.fullscreenElement) {
      return players.find(function (playerApi) {
        return playerApi.wrapper === document.fullscreenElement;
      }) || activePlayer || players[0] || null;
    }

    return activePlayer || players[0] || null;
  }

  function isEditableTarget(target) {
    if (!target || target === document.body) {
      return false;
    }

    var tagName = target.tagName;
    return (
      target.isContentEditable ||
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      tagName === "BUTTON"
    );
  }

  function buildPlayer(video) {
    if (!video || video.nodeType !== 1 || video.tagName !== "VIDEO" || video.hasAttribute(PLAYER_FLAG)) {
      return;
    }

    video.setAttribute(PLAYER_FLAG, "true");
    video.controls = false;
    video.playsInline = true;

    var wrapper = document.createElement("div");
    wrapper.className = "svp-player svp-paused";
    wrapper.tabIndex = 0;
    video.parentNode.insertBefore(wrapper, video);
    wrapper.appendChild(video);

    var overlay = document.createElement("div");
    overlay.className = "svp-overlay";
    overlay.innerHTML =
      '<div class="svp-header"><div class="svp-title" aria-live="polite"></div></div>' +
      '<div class="svp-center-toggle"><button type="button" class="svp-center-btn" aria-label="切换播放">' +
      icons.play +
      '</button></div>' +
      '<div class="svp-empty-state"><button type="button" class="svp-open-local-btn">' +
      icons.file +
      '<span>打开本地视频</span></button></div>' +
      '<div class="svp-controls">' +
      '  <div class="svp-progress" role="slider" tabindex="0" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '    <div class="svp-progress-buffer"></div>' +
      '    <div class="svp-progress-bar"></div>' +
      '    <div class="svp-progress-thumb"></div>' +
      "  </div>" +
      '  <div class="svp-bottom">' +
      '    <div class="svp-left">' +
      '      <button type="button" class="svp-btn svp-btn-play" aria-label="播放">' +
      icons.play +
      "</button>" +
      '      <div class="svp-time"><span class="svp-current">00:00</span> / <span class="svp-duration">00:00</span></div>' +
      "    </div>" +
      '    <div class="svp-right">' +
      '      <div class="svp-speed">' +
      '        <button type="button" class="svp-btn svp-btn-rate" aria-label="播放倍速">倍速</button>' +
      '        <div class="svp-speed-menu" role="menu" aria-label="播放倍速">' +
      '          <button type="button" class="svp-speed-option" data-rate="0.5">0.5x</button>' +
      '          <button type="button" class="svp-speed-option" data-rate="1">1.0x</button>' +
      '          <button type="button" class="svp-speed-option" data-rate="1.2">1.2x</button>' +
      '          <button type="button" class="svp-speed-option" data-rate="1.5">1.5x</button>' +
      '          <button type="button" class="svp-speed-option" data-rate="2">2.0x</button>' +
      "        </div>" +
      "      </div>" +
      '      <div class="svp-volume">' +
      '        <button type="button" class="svp-btn svp-btn-volume" aria-label="音量">' +
      icons.volume +
      "</button>" +
      '        <div class="svp-volume-panel">' +
      '          <div class="svp-volume-value">100</div>' +
      '          <input class="svp-volume-slider" type="range" min="0" max="100" step="1" value="' +
      String(Math.round((video.volume || 1) * 100)) +
      '" aria-label="音量调节">' +
      "        </div>" +
      "      </div>" +
      '      <button type="button" class="svp-btn svp-btn-fullscreen" aria-label="全屏">' +
      icons.fullscreen +
      "</button>" +
      "    </div>" +
      "  </div>" +
      "</div>";
    wrapper.appendChild(overlay);

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "video/*";
    fileInput.className = "svp-file-input";
    fileInput.tabIndex = -1;
    wrapper.appendChild(fileInput);

    var state = {
      hideTimer: null,
      centerIconTimer: null,
      seeking: false,
      objectUrl: ""
    };

    var titleNode = overlay.querySelector(".svp-title");
    var centerBtn = overlay.querySelector(".svp-center-btn");
    var openLocalBtn = overlay.querySelector(".svp-open-local-btn");
    var playBtn = overlay.querySelector(".svp-btn-play");
    var volumeBtn = overlay.querySelector(".svp-btn-volume");
    var volumeWrap = overlay.querySelector(".svp-volume");
    var volumeValue = overlay.querySelector(".svp-volume-value");
    var fullscreenBtn = overlay.querySelector(".svp-btn-fullscreen");
    var speedBtn = overlay.querySelector(".svp-btn-rate");
    var speedWrap = overlay.querySelector(".svp-speed");
    var speedOptions = overlay.querySelectorAll(".svp-speed-option");
    var controls = overlay.querySelector(".svp-controls");
    var currentNode = overlay.querySelector(".svp-current");
    var durationNode = overlay.querySelector(".svp-duration");
    var progress = overlay.querySelector(".svp-progress");
    var progressBar = overlay.querySelector(".svp-progress-bar");
    var progressBuffer = overlay.querySelector(".svp-progress-buffer");
    var progressThumb = overlay.querySelector(".svp-progress-thumb");
    var volumeSlider = overlay.querySelector(".svp-volume-slider");

    function hasPlayableSource() {
      return Boolean(
        video.currentSrc ||
        video.getAttribute("src") ||
        video.querySelector("source[src]")
      );
    }

    function getVideoTitle() {
      if (video.dataset.svpLocalFileName) {
        return video.dataset.svpLocalFileName;
      }

      return getTitleFromSrc(video.currentSrc || video.getAttribute("src"));
    }

    function syncTitle() {
      var title = getVideoTitle();
      titleNode.textContent = title;
      wrapper.classList.toggle("svp-has-title", Boolean(title));
    }

    function revokeObjectUrl() {
      if (!state.objectUrl) {
        return;
      }

      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = "";
    }

    function openLocalPicker() {
      fileInput.click();
    }

    function loadLocalFile(file) {
      if (!file) {
        return;
      }

      revokeObjectUrl();
      state.objectUrl = URL.createObjectURL(file);
      video.dataset.svpLocalFileName = file.name;
      video.src = state.objectUrl;
      video.load();
      syncTitle();
      video.play().catch(function () {});
    }

    function showCenterIcon(delay) {
      window.clearTimeout(state.centerIconTimer);
      wrapper.classList.add("svp-show-center-icon");
      if (!video.paused && !video.ended) {
        state.centerIconTimer = window.setTimeout(function () {
          wrapper.classList.remove("svp-show-center-icon");
        }, typeof delay === "number" ? delay : CENTER_ICON_DELAY);
      }
    }

    function closeSpeedMenu() {
      speedWrap.classList.remove("svp-speed-open");
    }

    function forceHideSpeedMenu() {
      closeSpeedMenu();
      speedWrap.classList.add("svp-speed-force-hide");
    }

    function clearForceHideSpeedMenu() {
      speedWrap.classList.remove("svp-speed-force-hide");
    }

    function syncSpeed() {
      speedBtn.textContent = "倍速";
      speedOptions.forEach(function (option) {
        var selected = Number(option.getAttribute("data-rate")) === video.playbackRate;
        option.classList.toggle("svp-active", selected);
      });
    }

    function syncEmptyState() {
      var empty = !hasPlayableSource();
      wrapper.classList.toggle("svp-empty", empty);
      if (empty) {
        window.clearTimeout(state.hideTimer);
        wrapper.classList.remove("svp-idle");
        wrapper.classList.remove("svp-show-center-icon");
        closeSpeedMenu();
        volumeWrap.classList.remove("svp-volume-open");
      } else {
        scheduleHide();
      }
      syncTitle();
    }

    function showControls() {
      window.clearTimeout(state.hideTimer);
      wrapper.classList.remove("svp-idle");
      wrapper.classList.remove("svp-fullscreen-idle");
    }

    function hideControls() {
      window.clearTimeout(state.hideTimer);
      if (
        wrapper.classList.contains("svp-empty") ||
        state.seeking ||
        speedWrap.classList.contains("svp-speed-open") ||
        speedWrap.matches(":hover") ||
        speedWrap.matches(":focus-within") ||
        volumeWrap.matches(":hover") ||
        volumeWrap.matches(":focus-within") ||
        volumeWrap.classList.contains("svp-volume-open")
      ) {
        return;
      }
      wrapper.classList.add("svp-idle");
      if (wrapper.classList.contains("svp-fullscreen")) {
        wrapper.classList.add("svp-fullscreen-idle");
      }
    }

    function scheduleHide() {
      showControls();
      if (state.seeking) {
        return;
      }
      state.hideTimer = window.setTimeout(hideControls, AUTOHIDE_DELAY);
    }

    function syncPlayState() {
      var paused = video.paused || video.ended;
      wrapper.classList.toggle("svp-paused", paused);
      playBtn.innerHTML = paused ? icons.play : icons.pause;
      centerBtn.innerHTML = paused ? icons.play : icons.pause;
      playBtn.setAttribute("aria-label", paused ? "播放" : "暂停");
      centerBtn.setAttribute("aria-label", paused ? "播放" : "暂停");
      if (paused) {
        wrapper.classList.add("svp-show-center-icon");
      } else {
        showCenterIcon(CENTER_ICON_DELAY);
      }
      syncEmptyState();
    }

    function syncTime() {
      var duration = Number.isFinite(video.duration) ? video.duration : 0;
      var current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      var ratio = duration > 0 ? current / duration : 0;
      currentNode.textContent = formatTime(current);
      durationNode.textContent = formatTime(duration);
      progressBar.style.width = ratio * 100 + "%";
      progressThumb.style.left = ratio * 100 + "%";
      progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    }

    function syncBuffered() {
      if (!video.buffered || !video.buffered.length || !Number.isFinite(video.duration) || video.duration <= 0) {
        progressBuffer.style.width = "0%";
        return;
      }

      var end = video.buffered.end(video.buffered.length - 1);
      progressBuffer.style.width = clamp(end / video.duration, 0, 1) * 100 + "%";
    }

    function syncVolume() {
      var volume = video.muted ? 0 : Math.round(video.volume * 100);
      volumeSlider.value = String(volume);
      volumeValue.textContent = String(volume);
      volumeBtn.innerHTML = volume === 0 ? icons.muted : icons.volume;
      volumeBtn.setAttribute("aria-label", volume === 0 ? "取消静音" : "静音");
    }

    function syncFullscreen() {
      var isFull = document.fullscreenElement === wrapper;
      wrapper.classList.toggle("svp-fullscreen", isFull);
      fullscreenBtn.innerHTML = isFull ? icons.exitFullscreen : icons.fullscreen;
      fullscreenBtn.setAttribute("aria-label", isFull ? "退出全屏" : "全屏");
      showControls();
      syncEmptyState();
    }

    function seekBy(delta) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }
      video.currentTime = clamp(video.currentTime + delta, 0, video.duration);
      syncTime();
    }

    function togglePlay() {
      setActivePlayer(playerApi);
      if (video.paused || video.ended) {
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    }

    function setProgressFromClientX(clientX) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }

      var rect = progress.getBoundingClientRect();
      var ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      video.currentTime = ratio * video.duration;
      syncTime();
    }

    function startSeek(clientX) {
      state.seeking = true;
      wrapper.classList.add("svp-seeking");
      setProgressFromClientX(clientX);
    }

    function endSeek() {
      state.seeking = false;
      wrapper.classList.remove("svp-seeking");
    }

    function toggleFullscreen() {
      if (document.fullscreenElement === wrapper) {
        document.exitFullscreen().catch(function () {});
        return;
      }

      if (wrapper.requestFullscreen) {
        wrapper.requestFullscreen().catch(function () {});
      }
    }

    var playerApi = {
      wrapper: wrapper,
      video: video,
      togglePlay: togglePlay,
      seekBy: seekBy,
      showControls: function () {
        scheduleHide();
      }
    };

    players.push(playerApi);

    video.addEventListener("loadedmetadata", function () {
      wrapper.classList.add("svp-ready");
      syncTime();
      syncBuffered();
      syncVolume();
      syncTitle();
      syncEmptyState();
    });
    video.addEventListener("loadstart", syncEmptyState);
    video.addEventListener("timeupdate", syncTime);
    video.addEventListener("durationchange", syncTime);
    video.addEventListener("progress", syncBuffered);
    video.addEventListener("play", syncPlayState);
    video.addEventListener("pause", syncPlayState);
    video.addEventListener("volumechange", syncVolume);
    video.addEventListener("emptied", syncEmptyState);
    video.addEventListener("error", syncEmptyState);
    video.addEventListener("contextmenu", function (event) {
      event.preventDefault();
    });
    video.addEventListener("click", function (event) {
      if (event.target === video) {
        setActivePlayer(playerApi);
        togglePlay();
      }
    });
    video.addEventListener("mouseenter", function () {
      setActivePlayer(playerApi);
      showControls();
      scheduleHide();
    });

    playBtn.addEventListener("click", togglePlay);
    centerBtn.addEventListener("click", togglePlay);
    openLocalBtn.addEventListener("click", function () {
      openLocalPicker();
      var openEvent = new CustomEvent("svp:open-local-video", {
        bubbles: true,
        detail: {
          video: video,
          wrapper: wrapper
        }
      });
      video.dispatchEvent(openEvent);
    });
    fileInput.addEventListener("change", function () {
      loadLocalFile(fileInput.files && fileInput.files[0]);
      fileInput.value = "";
    });
    volumeBtn.addEventListener("click", function () {
      setActivePlayer(playerApi);
      volumeWrap.classList.toggle("svp-volume-open");
      showControls();
      scheduleHide();
    });
    volumeSlider.addEventListener("input", function () {
      setActivePlayer(playerApi);
      wrapper.classList.add("svp-volume-active");
      video.muted = false;
      video.volume = Number(volumeSlider.value) / 100;
      if (Number(volumeSlider.value) === 0) {
        video.muted = true;
      }
      syncVolume();
      scheduleHide();
    });
    volumeSlider.addEventListener("change", function () {
      wrapper.classList.remove("svp-volume-active");
    });
    speedBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      setActivePlayer(playerApi);
      clearForceHideSpeedMenu();
      speedWrap.classList.toggle("svp-speed-open");
      if (speedWrap.classList.contains("svp-speed-open")) {
        speedBtn.focus({ preventScroll: true });
      } else {
        speedBtn.blur();
      }
      showControls();
      scheduleHide();
    });
    speedOptions.forEach(function (option) {
      option.addEventListener("click", function (event) {
        event.stopPropagation();
        setActivePlayer(playerApi);
        video.playbackRate = Number(option.getAttribute("data-rate"));
        syncSpeed();
        forceHideSpeedMenu();
        speedBtn.blur();
        if (wrapper.focus) {
          wrapper.focus({ preventScroll: true });
        }
        scheduleHide();
      });
    });
    fullscreenBtn.addEventListener("click", toggleFullscreen);

    progress.addEventListener("click", function (event) {
      setActivePlayer(playerApi);
      setProgressFromClientX(event.clientX);
      scheduleHide();
    });
    progress.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-SEEK_STEP);
        scheduleHide();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(SEEK_STEP);
        scheduleHide();
      }
    });
    progress.addEventListener("pointerdown", function (event) {
      setActivePlayer(playerApi);
      progress.setPointerCapture(event.pointerId);
      startSeek(event.clientX);
    });
    progress.addEventListener("pointermove", function (event) {
      if (state.seeking) {
        setProgressFromClientX(event.clientX);
      }
    });
    progress.addEventListener("pointerup", function () {
      endSeek();
      scheduleHide();
    });
    progress.addEventListener("pointercancel", endSeek);

    wrapper.addEventListener("mouseenter", function () {
      setActivePlayer(playerApi);
      showControls();
      scheduleHide();
    });
    wrapper.addEventListener("mousemove", function () {
      setActivePlayer(playerApi);
      scheduleHide();
    });
    wrapper.addEventListener("focus", function () {
      setActivePlayer(playerApi);
      showControls();
    });
    wrapper.addEventListener("click", function () {
      setActivePlayer(playerApi);
      wrapper.focus({ preventScroll: true });
    });
    wrapper.addEventListener("mouseleave", function () {
      hideControls();
    });
    wrapper.addEventListener("contextmenu", function (event) {
      event.preventDefault();
    });
    wrapper.addEventListener("touchstart", scheduleHide, { passive: true });
    speedWrap.addEventListener("mouseenter", function () {
      clearForceHideSpeedMenu();
      showControls();
    });
    speedWrap.addEventListener("mouseleave", function () {
      closeSpeedMenu();
      clearForceHideSpeedMenu();
      speedBtn.blur();
      scheduleHide();
    });
    volumeWrap.addEventListener("mouseenter", function () {
      volumeWrap.classList.add("svp-volume-open");
      showControls();
    });
    volumeWrap.addEventListener("mouseleave", function () {
      volumeWrap.classList.remove("svp-volume-open");
      scheduleHide();
    });

    document.addEventListener("click", function (event) {
      if (!speedWrap.contains(event.target)) {
        closeSpeedMenu();
        clearForceHideSpeedMenu();
      }
      if (!volumeWrap.contains(event.target)) {
        volumeWrap.classList.remove("svp-volume-open");
      }
    });

    document.addEventListener("fullscreenchange", syncFullscreen);
    window.addEventListener("beforeunload", revokeObjectUrl);

    syncTime();
    syncBuffered();
    syncVolume();
    syncSpeed();
    syncTitle();
    syncEmptyState();
    syncPlayState();
  }

  function scan(root) {
    var videos = (root || document).querySelectorAll("video");
    videos.forEach(buildPlayer);
  }

  function observeNewVideos() {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) {
            return;
          }

          if (node.tagName === "VIDEO") {
            buildPlayer(node);
            return;
          }

          if (node.querySelectorAll) {
            scan(node);
          }
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  document.addEventListener("keydown", function (event) {
    if (isEditableTarget(event.target)) {
      return;
    }

    var playerApi = getCurrentPlayer();
    if (!playerApi) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      playerApi.togglePlay();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      playerApi.seekBy(-SEEK_STEP);
      playerApi.showControls();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      playerApi.seekBy(SEEK_STEP);
      playerApi.showControls();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scan(document);
      observeNewVideos();
    });
  } else {
    scan(document);
    observeNewVideos();
  }
})();
