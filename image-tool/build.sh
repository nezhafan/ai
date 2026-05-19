#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_OUTPUT_DIR="${PROJECT_ROOT}/build/bin"
BUNDLE_NAME="image-batch-processor"
APP_NAME="图片批量处理"
APP_NAME_EN="ImageBatchProcessor"
APP_BUNDLE_PATH="${BUILD_OUTPUT_DIR}/${BUNDLE_NAME}.app"
APP_BUNDLE_NAME="$(basename "${APP_BUNDLE_PATH}")"

PLATFORM_SYSTEM="$(uname -s)"

print_header() {
  echo
  echo "=============================="
  echo " 图片批量处理 Build Menu"
  echo "=============================="
  echo "1) macOS Apple Silicon (darwin/arm64)"
  echo "2) macOS Intel (darwin/amd64)"
  echo "3) Windows (windows/amd64)"
  echo
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_dependency_help() {
  local dependency="$1"

  case "${dependency}" in
    go)
      echo "  Install hint:"
      if [[ "${PLATFORM_SYSTEM}" == "Darwin" ]]; then
        echo "    brew install go"
      fi
      echo "    Or download from: https://go.dev/dl/"
      ;;
    npm)
      echo "  Install hint:"
      if [[ "${PLATFORM_SYSTEM}" == "Darwin" ]]; then
        echo "    brew install node"
      fi
      echo "    Or install Node.js from: https://nodejs.org/"
      ;;
    wails)
      echo "  Install hint:"
      echo "    go install github.com/wailsapp/wails/v2/cmd/wails@latest"
      echo "    Make sure \$GOPATH/bin or \$HOME/go/bin is in PATH."
      ;;
    clang)
      echo "  Install hint:"
      echo "    xcode-select --install"
      ;;
    xcode-select)
      echo "  Install hint:"
      echo "    xcode-select --install"
      ;;
    create-dmg)
      echo "  Install hint:"
      echo "    brew install create-dmg"
      ;;
  esac
}

check_dependency() {
  local dependency="$1"
  local missing=0

  if command_exists "${dependency}"; then
    echo "[OK] ${dependency}"
  else
    echo "[MISSING] ${dependency}"
    print_dependency_help "${dependency}"
    missing=1
  fi

  return "${missing}"
}

check_xcode_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    echo "[OK] xcode-select path"
  else
    echo "[MISSING] Xcode Command Line Tools"
    echo "  Install hint:"
    echo "    xcode-select --install"
    return 1
  fi
}

check_common_dependencies() {
  local failed=0

  echo "Checking common build dependencies..."
  check_dependency go || failed=1
  check_dependency npm || failed=1
  check_dependency wails || failed=1

  return "${failed}"
}

check_macos_dependencies() {
  local failed=0

  check_common_dependencies || failed=1

  echo "Checking macOS build dependencies..."
  check_dependency clang || failed=1
  check_dependency xcode-select || failed=1
  check_dependency create-dmg || failed=1
  check_xcode_clt || failed=1

  return "${failed}"
}

check_windows_dependencies() {
  echo "Checking Windows build dependencies..."
  check_common_dependencies
}

run_build() {
  local platform="$1"
  local label="$2"

  mkdir -p "${PROJECT_ROOT}/build"
  ln -sfn "../appicon.png" "${PROJECT_ROOT}/build/appicon.png"

  echo
  echo "Target: ${label}"
  echo "Command: wails build -platform ${platform}"
  echo

  (
    cd "${PROJECT_ROOT}"
    wails build -platform "${platform}"
  )

  echo
  echo "Build completed."
  echo "Output directory: ${BUILD_OUTPUT_DIR}"
}

cleanup_app_bundle() {
  if [[ -d "${APP_BUNDLE_PATH}" ]]; then
    rm -rf "${APP_BUNDLE_PATH}"
    echo "Removed intermediate app bundle: ${APP_BUNDLE_PATH}"
  fi
}

create_macos_dmg() {
  local arch_label="$1"
  local dmg_name="${APP_NAME_EN}-${arch_label}.dmg"
  local dmg_path="${BUILD_OUTPUT_DIR}/${dmg_name}"
  local staging_dir

  if [[ ! -d "${APP_BUNDLE_PATH}" ]]; then
    echo "App bundle not found: ${APP_BUNDLE_PATH}"
    return 1
  fi

  staging_dir="$(mktemp -d)"

  cp -R "${APP_BUNDLE_PATH}" "${staging_dir}/${APP_NAME}.app"
  rm -f "${dmg_path}"

  echo
  echo "Creating DMG: ${dmg_name}"
  create-dmg \
    --sandbox-safe \
    --volname "${APP_NAME}" \
    --window-pos 200 120 \
    --window-size 800 420 \
    --icon-size 100 \
    --icon "${APP_NAME}.app" 180 210 \
    --hide-extension "${APP_NAME}.app" \
    --app-drop-link 620 210 \
    "${dmg_path}" \
    "${staging_dir}"

  rm -rf "${staging_dir}"

  echo "DMG created: ${dmg_path}"
}

build_macos_arm64() {
  if ! check_macos_dependencies; then
    echo
    echo "Dependency check failed. Install the missing items and try again."
    return 1
  fi

  run_build "darwin/arm64" "macOS Apple Silicon"
  create_macos_dmg "darwin-arm64"
  cleanup_app_bundle
}

build_macos_amd64() {
  if ! check_macos_dependencies; then
    echo
    echo "Dependency check failed. Install the missing items and try again."
    return 1
  fi

  run_build "darwin/amd64" "macOS Intel"
  create_macos_dmg "darwin-amd64"
  cleanup_app_bundle
}

build_windows_amd64() {
  if ! check_windows_dependencies; then
    echo
    echo "Dependency check failed. Install the missing items and try again."
    return 1
  fi

  run_build "windows/amd64" "Windows"
}

main() {
  print_header
  read -r -p "Choose a build target: " choice

  case "${choice}" in
    1)
      build_macos_arm64
      ;;
    2)
      build_macos_amd64
      ;;
    3)
      build_windows_amd64
      ;;
    *)
      echo "Invalid option: ${choice}"
      return 1
      ;;
  esac
}

main
