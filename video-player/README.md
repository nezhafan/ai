### 视频播放器

![](./demo.png)

## 打包

先给脚本执行权限：

```bash
chmod +x ./build.sh
```

运行打包菜单：

```bash
./build.sh
```

菜单说明：

- `1` 打包 mac Intel 版本 `darwin/amd64`
- `2` 打包 mac Apple Silicon 版本 `darwin/arm64`
- `3` 打包 Windows exe `windows/amd64`
- `4` 连续打包全部目标
- `0` 退出

默认使用 `wails build -clean -platform ...` 进行构建，产物通常会输出到 `build/bin/`。

如果选择 Windows 交叉编译失败，通常表示当前 mac 缺少对应的交叉编译工具链；脚本会直接输出 Wails/Go 的报错，按报错补齐环境即可。
