#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ENTRY="$SCRIPT_DIR/app.py"
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$SCRIPT_DIR/dist"
SETUP_FILE="$SCRIPT_DIR/.build_py2app_setup.py"
SPEC_FILE="$SCRIPT_DIR/menubar_monitor.spec"
ICON_FILE="$SCRIPT_DIR/assets/app-icon.icns"

CHECK_ONLY=0
CLEAN_FIRST=0
BACKEND="auto"

MISSING_ITEMS=""
INSTALL_HINTS=""

usage() {
    cat <<'EOF'
Usage: ./build.sh [--check] [--clean]

Options:
  --check   Only check environment, do not build
  --clean   Remove build/ and dist/ before building
  --backend <pyinstaller|py2app|auto>  Build backend (default: auto)
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
        append_missing "缺少命令: $cmd" "$hint"
    fi
}

check_python_import() {
    import_expr="$1"
    package_hint="$2"
    if ! python3 -c "$import_expr" >/dev/null 2>&1; then
        append_missing "缺少 Python 依赖: $package_hint" \
            "python3 -m pip install $package_hint"
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

resolve_backend() {
    case "$BACKEND" in
        auto)
            if [ -f "$SPEC_FILE" ]; then
                BACKEND="pyinstaller"
            else
                BACKEND="py2app"
            fi
            ;;
        pyinstaller|py2app)
            ;;
        *)
            printf '%s\n' "不支持的 backend: $BACKEND"
            usage
            exit 2
            ;;
    esac
}

check_environment() {
    if [ "$(uname -s)" != "Darwin" ]; then
        append_missing "当前系统不是 macOS（py2app 仅支持 macOS）" \
            "请在 macOS 上执行构建"
    fi

    if [ ! -f "$APP_ENTRY" ]; then
        append_missing "未找到入口文件: $APP_ENTRY" \
            "确认项目目录完整，并包含 app.py"
    fi

    check_command "python3" "请安装 Python 3（https://www.python.org/downloads/）"

    if command -v python3 >/dev/null 2>&1; then
        if ! python3 -m pip --version >/dev/null 2>&1; then
            append_missing "python3 可用，但 pip 不可用" \
                "python3 -m ensurepip --upgrade"
        fi
    fi

    if command -v python3 >/dev/null 2>&1; then
        case "$BACKEND" in
            pyinstaller)
                check_python_import "import PyInstaller" "pyinstaller"
                check_python_import "import psutil" "psutil"
                check_python_import "import objc, AppKit, Foundation" \
                    "pyobjc-core pyobjc-framework-Cocoa"
                ;;
            py2app)
                check_python_import "import setuptools" "setuptools"
                check_python_import "import py2app" "py2app"
                check_python_import "import psutil" "psutil"
                check_python_import "import objc, AppKit, Foundation" \
                    "pyobjc-core pyobjc-framework-Cocoa"
                ;;
        esac
    fi

    if [ "$BACKEND" = "pyinstaller" ] && [ ! -f "$SPEC_FILE" ]; then
        append_missing "缺少打包配置: $SPEC_FILE" \
            "请确认 menubar_monitor.spec 存在"
    fi

    if [ ! -f "$ICON_FILE" ]; then
        append_missing "缺少图标文件: $ICON_FILE" \
            "请补充图标文件后重试"
    fi

    print_missing_and_exit_if_needed
}

cleanup_temp_setup() {
    rm -f "$SETUP_FILE"
}

write_setup_file() {
    cat >"$SETUP_FILE" <<'PY'
from setuptools import setup

APP = ["app.py"]
OPTIONS = {
    "argv_emulation": False,
    "iconfile": "assets/app-icon.icns",
    "includes": ["objc", "psutil", "AppKit", "Foundation"],
    "excludes": [
        "distutils",
        "numpy",
        "PyInstaller",
        "pytest",
        "setuptools",
        "test",
        "tests",
        "tkinter",
        "unittest",
    ],
    "plist": {
        "CFBundleDisplayName": "Mac Monitor",
        "CFBundleExecutable": "Mac Monitor",
        "CFBundleIdentifier": "com.codex.mac-menu-bar-monitor",
        "CFBundleName": "Mac Monitor",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "LSUIElement": True,
        "NSHumanReadableCopyright": "Codex",
    },
    "packages": ["objc", "psutil", "AppKit", "Foundation"],
    "strip": True,
}

setup(
    app=APP,
    name="Mac Monitor",
    options={"py2app": OPTIONS},
)
PY
}

run_build() {
    if [ "$CLEAN_FIRST" -eq 1 ]; then
        rm -rf "$BUILD_DIR" "$DIST_DIR"
    fi

    case "$BACKEND" in
        pyinstaller)
            (cd "$SCRIPT_DIR" && python3 -m PyInstaller --clean --noconfirm "$SPEC_FILE")
            ;;
        py2app)
            trap cleanup_temp_setup EXIT INT TERM
            write_setup_file
            (cd "$SCRIPT_DIR" && python3 "$SETUP_FILE" py2app)
            cleanup_temp_setup
            trap - EXIT INT TERM
            ;;
    esac

    printf '%s\n' "构建完成（backend: ${BACKEND:-unknown}）：${DIST_DIR}/Mac Monitor.app"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --check)
            CHECK_ONLY=1
            ;;
        --clean)
            CLEAN_FIRST=1
            ;;
        --backend)
            shift
            if [ $# -eq 0 ]; then
                printf '%s\n' "--backend 需要参数"
                usage
                exit 2
            fi
            BACKEND="$1"
            ;;
        --backend=*)
            BACKEND="${1#*=}"
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

resolve_backend
check_environment

if [ "$CHECK_ONLY" -eq 1 ]; then
    printf '%s\n' "环境检查通过（backend: $BACKEND）。"
    exit 0
fi

run_build
