# Image Tool - Mac 图片处理工具

一个基于 Tauri 开发的 macOS 原生图片处理应用，所有处理在本地完成，图片不会上传到服务器。

![](./demo.png)

## 功能

1. **格式转换** - 在 JPG、JPEG、PNG 格式之间互相转换
2. **图片缩放** - 支持按尺寸或百分比等比缩放
3. **图片压缩** - 调整图片质量，减小文件体积
4. **蒙版转透明** - 使用蒙版图片将指定区域转为透明

## 技术栈

- **前端**: React + TypeScript + Vite + TailwindCSS
- **后端**: Tauri (Rust)
- **图片处理**: Rust `image` crate + `imageproc`

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm run tauri:dev

# 构建
npm run build
npm run tauri:build
```

## 构建

统一打包入口：

```bash
# 执行后按提示输入编号选择目标平台
./build.sh

# 仅预览实际会执行的命令
./build.sh --dry-run
```

也可以通过 npm scripts 调用：

```bash
npm run package
```

说明：

- 运行脚本后输入 `1` 打包 macOS，输入 `2` 打包 Windows
- 在 macOS 上，`macos` 为原生打包，只保留一个最终 `.dmg`，输出到 `release/macos/`
- 在 macOS 上，`windows` 会先检查当前 Tauri CLI 是否支持 `nsis`；如果本机 CLI 只暴露 `app/dmg`，脚本会直接报错并提示改用 Windows 机器或 CI
- 打包完成后会删除对应的 `src-tauri/target/.../release/` 目录，不保留中间安装包目录
- 脚本不会自动打开 `.dmg` 或触发安装，只会把最终安装包放到 `release/` 下
- 如果打 Windows 包缺少依赖，脚本会提示安装 `cargo-xwin`、`llvm`、`nsis` 和 Rust Windows target

## 项目结构

```
image-tool/
├── src/                   # React 前端
│   ├── components/         # UI 组件
│   ├── hooks/             # 自定义 Hooks
│   ├── lib/               # Tauri API 封装
│   └── types/             # TypeScript 类型
├── src-tauri/            # Rust 后端
│   ├── src/
│   │   ├── commands.rs    # Tauri 命令
│   │   ├── utils.rs       # 工具函数
│   │   ├── main.rs        # 入口
│   │   └── lib.rs        # 库文件
│   ├── tauri.conf.json   # Tauri 配置
│   └── Cargo.toml        # Rust 依赖
```
