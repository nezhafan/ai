#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$ROOT_DIR/release"

usage() {
  cat <<'EOF'
Usage: ./build.sh [--dry-run]

Build the Tauri application for the current host platform.

The script auto-detects the current platform:
  macos    Build a native macOS DMG
  windows  Build a native Windows NSIS installer
  linux    Not supported by this script

Options:
  --dry-run  Print the resolved build command without executing it
  -h, --help Show this help message
EOF
}

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

detect_host_platform() {
  case "$(uname -s)" in
    Darwin) printf 'macos\n' ;;
    Linux) printf 'linux\n' ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) printf 'windows\n' ;;
    *) fail "Unsupported host OS: $(uname -s)" ;;
  esac
}

ensure_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command_exists "$command_name"; then
    fail "Missing required command: $command_name. Install it with: $install_hint"
  fi
}

prepare_release_dir() {
  local platform="$1"
  local platform_release_dir="$RELEASE_DIR/$platform"

  rm -rf "$platform_release_dir"
  mkdir -p "$platform_release_dir"
}

cleanup_target_dirs() {
  case "$1" in
    macos)
      rm -rf "$ROOT_DIR/src-tauri/target/release"
      ;;
    windows)
      rm -rf "$ROOT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release"
      ;;
  esac
}

copy_single_artifact() {
  local source_dir="$1"
  local pattern="$2"
  local destination_dir="$3"
  local label="$4"

  shopt -s nullglob
  local matches=("$source_dir"/$pattern)
  shopt -u nullglob

  if [[ ${#matches[@]} -eq 0 ]]; then
    fail "No $label artifact found in $source_dir matching $pattern"
  fi

  if [[ ${#matches[@]} -gt 1 ]]; then
    fail "Expected exactly one $label artifact in $source_dir matching $pattern, found ${#matches[@]}"
  fi

  cp "${matches[0]}" "$destination_dir/"
  printf '%s\n' "$destination_dir/$(basename "${matches[0]}")"
}

dry_run=false
target_platform=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

host_platform="$(detect_host_platform)"
target_platform="$host_platform"

case "$target_platform" in
  macos)
    bundle_dir="src-tauri/target/release/bundle/macos"
    build_cmd=(npm run tauri:build -- --bundles dmg)
    artifact_pattern="*.dmg"
    artifact_label="macOS DMG"
    ;;
  windows)
    bundle_dir="src-tauri/target/release/bundle/nsis"
    build_cmd=(npm run tauri:build -- --bundles nsis)
    artifact_pattern="*-setup.exe"
    artifact_label="Windows installer"
    ;;
  linux)
    fail "当前系统 Linux 暂不支持直接打包安装包"
    ;;
  *)
    fail "Unsupported host platform: $host_platform"
    ;;
esac

if [[ "$dry_run" == true ]]; then
  log "Host platform: $host_platform"
  log "Target platform: $target_platform"
  log "Bundle output: $bundle_dir"
  log "Release output: release/$target_platform"
  log "Build command: ${build_cmd[*]}"
  exit 0
fi

ensure_command npm "npm install"
ensure_command cargo "https://rustup.rs/"

log "Host platform: $host_platform"
log "Target platform: $target_platform"
log "Bundle output: $bundle_dir"
log "Release output: release/$target_platform"
log "Running: ${build_cmd[*]}"

prepare_release_dir "$target_platform"
cleanup_target_dirs "$target_platform"

(
  cd "$ROOT_DIR"
  "${build_cmd[@]}"
)

final_artifact="$(copy_single_artifact "$ROOT_DIR/$bundle_dir" "$artifact_pattern" "$RELEASE_DIR/$target_platform" "$artifact_label")"
cleanup_target_dirs "$target_platform"

log "Build finished. Final artifact: $final_artifact"
