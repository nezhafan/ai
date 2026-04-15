#!/usr/bin/env bash

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_OUTPUT_DIR="$PROJECT_ROOT/build/bin"

print_header() {
  echo
  echo "=============================="
  echo " Video Player Build Menu"
  echo "=============================="
  echo "1) Build macOS Intel (darwin/amd64)"
  echo "2) Build macOS Apple Silicon (darwin/arm64)"
  echo "3) Build Windows EXE (windows/amd64)"
  echo "4) Build all targets"
  echo "0) Exit"
  echo
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    return 1
  fi
}

check_common_dependencies() {
  local missing=0

  require_command go || missing=1
  require_command npm || missing=1
  require_command wails || missing=1

  if [[ "$missing" -ne 0 ]]; then
    echo
    echo "Please install the missing dependencies first, then run this script again."
    return 1
  fi
}

build_target() {
  local label="$1"
  local platform="$2"

  echo
  echo ">>> Building $label"
  echo ">>> Platform: $platform"

  if ! wails build -clean -platform "$platform"; then
    echo
    echo "Build failed for $label."
    if [[ "$platform" == "windows/amd64" ]]; then
      echo "Windows cross-compilation may require additional toolchain support on macOS."
      echo "Please check the error output above for the missing compiler or SDK details."
    fi
    return 1
  fi

  echo
  echo "Build completed for $label."
  echo "Artifacts are usually in: $BUILD_OUTPUT_DIR"
}

build_all() {
  build_target "macOS Intel" "darwin/amd64" || return 1
  build_target "macOS Apple Silicon" "darwin/arm64" || return 1
  build_target "Windows EXE" "windows/amd64" || return 1
}

main() {
  cd "$PROJECT_ROOT" || exit 1

  if ! check_common_dependencies; then
    exit 1
  fi

  while true; do
    print_header
    read -r -p "Choose a build target: " choice

    case "$choice" in
      1)
        build_target "macOS Intel" "darwin/amd64"
        ;;
      2)
        build_target "macOS Apple Silicon" "darwin/arm64"
        ;;
      3)
        build_target "Windows EXE" "windows/amd64"
        ;;
      4)
        build_all
        ;;
      0)
        echo "Exit."
        exit 0
        ;;
      *)
        echo "Invalid choice: $choice"
        ;;
    esac
  done
}

main "$@"
