#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "========================================"
echo "      Image View 打包脚本"
echo "========================================"
echo

NEED_INSTALL=false

# 检查 Node.js
check_node() {
  if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//')
    echo "  Node.js: $NODE_VERSION"
    return 0
  else
    echo "  Node.js: 未安装"
    return 1
  fi
}

# 检查 npm
check_npm() {
  if command -v npm &>/dev/null; then
    NPM_VERSION=$(npm -v)
    echo "  npm: $NPM_VERSION"
    return 0
  else
    echo "  npm: 未安装"
    return 1
  fi
}

# 检查 Rust
check_rust() {
  if command -v rustc &>/dev/null; then
    RUST_VERSION=$(rustc --version | awk '{print $2}')
    echo "  Rust: $RUST_VERSION"
    return 0
  else
    echo "  Rust: 未安装"
    return 1
  fi
}

# 检查 Tauri CLI
check_tauri_cli() {
  if command -v cargo &>/dev/null && cargo tauri --version &>/dev/null 2>&1; then
    TAURI_VERSION=$(cargo tauri --version)
    echo "  Tauri CLI: $TAURI_VERSION"
    return 0
  elif npx tauri --version &>/dev/null 2>&1; then
    TAURI_VERSION=$(npx tauri --version)
    echo "  Tauri CLI: $TAURI_VERSION (via npx)"
    return 0
  else
    echo "  Tauri CLI: 未安装"
    return 1
  fi
}

# 运行环境检查
echo "【1/2】检查运行环境..."
echo

ENV_OK=true
if ! check_node; then ENV_OK=false; fi
if ! check_npm; then ENV_OK=false; fi
if ! check_rust; then ENV_OK=false; fi
if ! check_tauri_cli; then ENV_OK=false; fi

echo

if [ "$ENV_OK" = false ]; then
  echo "⚠️ 检测到部分依赖缺失，建议按以下方式安装："
  echo
  echo "  1. Node.js (含 npm)"
  echo "     官网下载安装: https://nodejs.org/"
  echo "     或使用 nvm: nvm install --lts"
  echo
  echo "  2. Rust"
  echo "     官网: https://www.rust-lang.org/tools/install"
  echo "     安装命令: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo
  echo "  3. Tauri CLI"
  echo "     安装命令: cargo install tauri-cli --locked"
  echo "     或本地安装: npm install -D @tauri-apps/cli"
  echo
  read -rp "环境未就绪，是否仍要继续? (y/N): " CONTINUE
  if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 1
  fi
  echo
fi

# 安装前端依赖
if [ ! -d "node_modules" ]; then
  echo "【提示】检测到 node_modules 缺失，正在执行 npm install..."
  npm install
  echo
fi

# 确定 Tauri 命令
TAURI_CMD=""
if cargo tauri --version &>/dev/null 2>&1; then
  TAURI_CMD="cargo tauri build --target"
elif npx tauri --version &>/dev/null 2>&1; then
  TAURI_CMD="npx tauri build --target"
else
  echo "❌ 错误: 未找到可用的 Tauri CLI，无法继续打包"
  exit 1
fi

echo "【2/2】选择打包目标"
echo
echo "  1) Windows (x86_64-pc-windows-msvc)"
echo "  2) macOS ARM64 (aarch64-apple-darwin)"
echo "  3) macOS AMD64 (x86_64-apple-darwin)"
echo "  4) 全部打包"
echo
read -rp "请输入选项编号 (1-4): " CHOICE

echo

case "$CHOICE" in
  1)
    TARGET="x86_64-pc-windows-msvc"
    echo "开始打包 Windows 版本..."
    $TAURI_CMD "$TARGET"
    ;;
  2)
    TARGET="aarch64-apple-darwin"
    echo "开始打包 macOS ARM64 版本..."
    $TAURI_CMD "$TARGET"
    ;;
  3)
    TARGET="x86_64-apple-darwin"
    echo "开始打包 macOS AMD64 版本..."
    $TAURI_CMD "$TARGET"
    ;;
  4)
    echo "开始打包全部目标..."
    $TAURI_CMD "x86_64-pc-windows-msvc"
    $TAURI_CMD "aarch64-apple-darwin"
    $TAURI_CMD "x86_64-apple-darwin"
    ;;
  *)
    echo "无效选项: $CHOICE"
    exit 1
    ;;
esac

echo
echo "========================================"
echo "      打包完成"
echo "========================================"
echo "输出目录: src-tauri/target/release/bundle"
