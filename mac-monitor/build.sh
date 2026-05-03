#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ENTRY="$SCRIPT_DIR/app.py"
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$SCRIPT_DIR/dist"
SPEC_FILE="$SCRIPT_DIR/menubar_monitor.spec"
ICON_FILE="$SCRIPT_DIR/assets/app-icon.icns"

APP_NAME="Mac Monitor"
APP_BUNDLE="${APP_NAME}.app"
SAFE_APP_NAME="Mac-Monitor"
TARGET_ARCH="arm64"

CHECK_ONLY=0
CLEAN_FIRST=0

MISSING_ITEMS=""
INSTALL_HINTS=""

usage() {
    cat <<'EOF'
Usage: ./build.sh [--check] [--clean]

This script only builds macOS Apple Silicon (arm64) DMG.

Options:
  --check   Only check environment, do not build
  --clean   Remove build/ and dist/ before building
  -h, --help  Show help
EOF
}

append_missing() {
    item="$1"
    hint="$2"
    MISSING_ITEMS="${MISSING_ITEMS}\n- ${item}"
    INSTALL_HINTS="${INSTALL_HINTS}\n- ${hint}"
}

check_command() {
    cmd="$1"
    hint="$2"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        append_missing "缺少命令: ${cmd}" "$hint"
    fi
}

check_python_import() {
    import_expr="$1"
    package_hint="$2"
    if ! python3 -c "$import_expr" >/dev/null 2>&1; then
        append_missing "缺少 Python 依赖: ${package_hint}" \
            "python3 -m pip install ${package_hint}"
    fi
}

print_missing_and_exit_if_needed() {
    if [ -n "$MISSING_ITEMS" ]; then
        printf '%s\n' "环境检查失败，检测到以下问题："
        printf '%b\n' "$MISSING_ITEMS"
        printf '\n%s\n' "请先安装依赖后再重试，建议命令："
        printf '%b\n' "$INSTALL_HINTS"
        exit 1
    fi
}

check_binary_arch_support() {
    binary_path="$1"
    target_arch="$2"
    label="$3"

    archs="$(lipo -archs "$binary_path" 2>/dev/null || true)"
    if [ -z "$archs" ]; then
        return 0
    fi

    case " $archs " in
        *" $target_arch "*)
            return 0
            ;;
        *)
            printf '%s\n' "架构预检查失败：${label} 不支持目标架构 ${target_arch}。"
            printf '%s\n' "  文件: ${binary_path}"
            printf '%s\n' "  当前架构: ${archs}"
            return 1
            ;;
    esac
}

check_environment() {
    if [ "$(uname -s)" != "Darwin" ]; then
        append_missing "当前系统不是 macOS（仅支持打包 macOS dmg）" \
            "请在 macOS 上执行构建"
    fi

    if [ ! -f "$APP_ENTRY" ]; then
        append_missing "未找到入口文件: ${APP_ENTRY}" \
            "确认项目目录完整，并包含 app.py"
    fi

    if [ ! -f "$SPEC_FILE" ]; then
        append_missing "缺少打包配置: ${SPEC_FILE}" \
            "请确认 menubar_monitor.spec 存在"
    fi

    if [ ! -f "$ICON_FILE" ]; then
        append_missing "缺少图标文件: ${ICON_FILE}" \
            "请补充图标文件后重试"
    fi

    check_command "python3" "请安装 Python 3（https://www.python.org/downloads/）"
    check_command "hdiutil" "macOS 自带 hdiutil，若不可用请确认系统工具链完整"
    check_command "lipo" "macOS 自带 lipo，若不可用请确认 Xcode Command Line Tools 已安装"

    if command -v python3 >/dev/null 2>&1; then
        if ! python3 -m pip --version >/dev/null 2>&1; then
            append_missing "python3 可用，但 pip 不可用" \
                "python3 -m ensurepip --upgrade"
        fi

        check_python_import "import PyInstaller" "pyinstaller"
        check_python_import "import psutil" "psutil"
        check_python_import "import objc, AppKit, Foundation" \
            "pyobjc-core pyobjc-framework-Cocoa"
    fi

    print_missing_and_exit_if_needed
}

verify_arm64_prerequisites() {
    python_bin="$(python3 -c 'import sys; print(sys.executable)' 2>/dev/null || true)"
    psutil_so="$(python3 -c 'import psutil, psutil._psutil_osx as m; print(m.__file__)' 2>/dev/null || true)"

    if [ -z "$python_bin" ] || [ -z "$psutil_so" ]; then
        printf '%s\n' "arm64 预检查失败：Python 或 psutil 不可用。"
        return 1
    fi

    check_binary_arch_support "$python_bin" "$TARGET_ARCH" "Python 解释器"
    check_binary_arch_support "$psutil_so" "$TARGET_ARCH" "psutil 扩展模块"
}

create_install_readme() {
    readme_path="$1"
    cat > "$readme_path" <<'EOF'
安装说明（macOS）

1. 将左侧的 "Mac Monitor.app" 拖动到 "Applications" 文件夹。
2. 在“应用程序”中打开 Mac Monitor。
3. 首次运行如遇到安全提示，请在“系统设置 -> 隐私与安全性”里允许打开。
EOF
}

create_dmg() {
    app_bundle_path="$1"
    dmg_dir="$DIST_DIR/dmg"
    final_dmg="$dmg_dir/${SAFE_APP_NAME}-arm64.dmg"
    tmp_dmg="$dmg_dir/.${SAFE_APP_NAME}-arm64.tmp.dmg"
    staging_dir="$DIST_DIR/dmg-staging"

    rm -rf "$staging_dir"
    mkdir -p "$staging_dir" "$dmg_dir"

    cp -R "$app_bundle_path" "$staging_dir/"
    ln -s /Applications "$staging_dir/Applications"
    create_install_readme "$staging_dir/安装说明.txt"

    rm -f "$final_dmg" "$tmp_dmg"
    hdiutil create \
        -volname "$APP_NAME" \
        -srcfolder "$staging_dir" \
        -ov \
        -format UDZO \
        "$tmp_dmg" >/dev/null

    mv "$tmp_dmg" "$final_dmg"
    printf '%s\n' "已生成 DMG: ${final_dmg}"
}

run_build() {
    if [ "$CLEAN_FIRST" -eq 1 ]; then
        rm -rf "$BUILD_DIR" "$DIST_DIR"
    fi

    if ! verify_arm64_prerequisites; then
        printf '%s\n' "请先安装 arm64 版本依赖后重试。"
        exit 1
    fi

    if ! (cd "$SCRIPT_DIR" && PYI_TARGET_ARCH="$TARGET_ARCH" python3 -m PyInstaller --clean --noconfirm "$SPEC_FILE"); then
        printf '%s\n' "PyInstaller 构建失败（arch: ${TARGET_ARCH}）。"
        exit 1
    fi

    built_app="$DIST_DIR/$APP_BUNDLE"
    if [ ! -d "$built_app" ]; then
        printf '%s\n' "构建失败：未找到应用包 ${built_app}"
        exit 1
    fi

    create_dmg "$built_app"
    printf '%s\n' "构建完成。DMG 输出目录: ${DIST_DIR}/dmg"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --check)
            CHECK_ONLY=1
            ;;
        --clean)
            CLEAN_FIRST=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf '%s\n' "未知参数: $1"
            usage
            exit 2
            ;;
    esac
    shift
done

check_environment

if [ "$CHECK_ONLY" -eq 1 ]; then
    printf '%s\n' "环境检查通过。默认仅构建架构: ${TARGET_ARCH}"
    exit 0
fi

run_build
