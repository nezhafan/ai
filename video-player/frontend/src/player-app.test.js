import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFullscreenController,
  buildMediaURL,
  clampVolume,
  createMarkup,
  dispatchSelectionState,
  formatTime,
  getFileNameFromPath,
  createDoubleClickGuard,
  shouldToggleWindowFullscreenOnDoubleClick,
  scheduleExternalSelectionStateSync,
  syncExternalSelectionState,
} from "./player-app.js";

test("formatTime formats mm:ss", () => {
  assert.equal(formatTime(65), "01:05");
});

test("clampVolume keeps values in range", () => {
  assert.equal(clampVolume(120), 1);
  assert.equal(clampVolume(-1), 0);
});

test("getFileNameFromPath extracts final segment", () => {
  assert.equal(getFileNameFromPath("/tmp/demo.mp4"), "demo.mp4");
});

test("buildMediaURL points to the in-app media route", () => {
  assert.equal(
    buildMediaURL("/tmp/demo video.mp4"),
    "/local-media?path=%2Ftmp%2Fdemo%20video.mp4",
  );
});

test("createMarkup keeps the shell minimal", () => {
  const markup = createMarkup();

  assert.match(markup, /<video class="video-player" preload="metadata"><\/video>/);
  assert.doesNotMatch(markup, /app-title/);
  assert.doesNotMatch(markup, /app-subtitle/);
  assert.doesNotMatch(markup, /app-open-btn/);
});

test("fullscreen controller prefers window fullscreen APIs", async () => {
  const calls = [];
  const controller = buildFullscreenController({
    isFullscreen: async () => false,
    enterFullscreen: async () => {
      calls.push("enter");
    },
    exitFullscreen: async () => {
      calls.push("exit");
    },
  });

  await controller.toggle();
  assert.deepEqual(calls, ["enter"]);
});

test("dispatchSelectionState notifies the player about source availability", () => {
  const events = [];
  const video = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  dispatchSelectionState(video, true, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "svp:selection-state");
  assert.equal(events[0].detail.hasSelection, true);
  assert.equal(events[0].detail.isLoading, true);
});

test("settings helpers are no longer exported", async () => {
  const playerAppModule = await import("./player-app.js");

  assert.equal("readSettings" in playerAppModule, false);
  assert.equal("writeSettings" in playerAppModule, false);
});

test("syncExternalSelectionState removes empty state when a Wails-picked file is applied", () => {
  const classes = new Set(["svp-player", "svp-empty"]);
  const stopButton = { disabled: true };
  const titleNode = { textContent: "" };
  const video = {
    dataset: {
      svpLocalFileName: "demo.mp4",
    },
    closest(selector) {
      assert.equal(selector, ".svp-player");
      return {
        classList: {
          toggle(name, force) {
            if (force) {
              classes.add(name);
            } else {
              classes.delete(name);
            }
          },
          remove(...names) {
            names.forEach((name) => classes.delete(name));
          },
          add(...names) {
            names.forEach((name) => classes.add(name));
          },
          contains(name) {
            return classes.has(name);
          },
        },
        querySelector(selector) {
          if (selector === ".svp-btn-stop") {
            return stopButton;
          }

          if (selector === ".svp-title") {
            return titleNode;
          }

          return null;
        },
      };
    },
  };

  syncExternalSelectionState(video, true, true);

  assert.equal(classes.has("svp-empty"), false);
  assert.equal(stopButton.disabled, false);
  assert.equal(titleNode.textContent, "demo.mp4");
  assert.equal(classes.has("svp-has-title"), true);
  assert.equal(classes.has("svp-ready"), false);
});

test("scheduleExternalSelectionStateSync defers wrapper sync until after native listeners run", () => {
  const calls = [];
  const video = { id: "video-1" };
  const scheduler = (callback) => {
    calls.push("scheduled");
    callback();
    return 1;
  };

  scheduleExternalSelectionStateSync(video, true, false, scheduler, (target, hasSelection, isLoading) => {
    calls.push([target, hasSelection, isLoading]);
  });

  assert.deepEqual(calls, ["scheduled", [video, true, false]]);
});

test("shouldToggleWindowFullscreenOnDoubleClick only accepts clicks on the video area", () => {
  const videoTarget = {
    closest(selector) {
      if (selector === ".svp-controls, .svp-empty-state, .svp-btn-fullscreen") {
        return null;
      }

      if (selector === ".svp-player") {
        return { id: "wrapper" };
      }

      return null;
    },
  };

  const controlsTarget = {
    closest(selector) {
      if (selector === ".svp-controls, .svp-empty-state, .svp-btn-fullscreen") {
        return { id: "controls" };
      }

      if (selector === ".svp-player") {
        return { id: "wrapper" };
      }

      return null;
    },
  };

  assert.equal(shouldToggleWindowFullscreenOnDoubleClick(videoTarget), true);
  assert.equal(shouldToggleWindowFullscreenOnDoubleClick(controlsTarget), false);
  assert.equal(shouldToggleWindowFullscreenOnDoubleClick(null), false);
});

test("createDoubleClickGuard delays single-click playback and cancels it for a following double click", () => {
  const calls = [];
  let pendingCallback = null;
  const guard = createDoubleClickGuard({
    scheduler(callback) {
      pendingCallback = callback;
      calls.push("scheduled");
      return 1;
    },
    cancelScheduler(timerId) {
      calls.push(["cancel", timerId]);
      pendingCallback = null;
    },
    onSingleClick(target) {
      calls.push(["single", target.id]);
    },
    onDoubleClick(target) {
      calls.push(["double", target.id]);
    },
  });

  const target = { id: "video-target" };

  guard.handleClick({ isTrusted: true, target, detail: 1 });
  assert.deepEqual(calls, ["scheduled"]);

  guard.handleDoubleClick({ target });
  assert.deepEqual(calls, ["scheduled", ["cancel", 1], ["double", "video-target"]]);

  calls.length = 0;
  guard.handleClick({ isTrusted: true, target, detail: 1 });
  pendingCallback();
  assert.deepEqual(calls, ["scheduled", ["single", "video-target"]]);
});
