import "./video-player.css";
import "./video-player.js";
import "./player-app.css";
import { initPlayerApp } from "./player-app.js";
import {
  WindowFullscreen,
  WindowIsFullscreen,
  WindowUnfullscreen,
} from "../wailsjs/runtime/runtime.js";

initPlayerApp({
  fullscreenRuntime: {
    enterFullscreen: WindowFullscreen,
    exitFullscreen: WindowUnfullscreen,
    isFullscreen: WindowIsFullscreen,
  },
});
