# ofive

ofive 是一个基于 Tauri + React + TypeScript + Rust 的桌面笔记应用，前端通过 Vite 构建，后端桌面容器由 Tauri 提供，AI sidecar 使用 Go 构建。

## 构建前提

无论在哪个平台，本项目都需要以下工具：

1. Bun
2. Rust stable toolchain
3. Go
4. `protoc`（Protocol Buffers 编译器）

说明：

- `bun run tauri dev` 会先执行 `bun run build:sidecar`
- `build:sidecar` 会调用 `go` 和 `protoc`
- 如果缺少任一前置，桌面开发和桌面打包都会失败

## Windows 构建说明

### 1. 安装前置

建议使用 `winget`：

```powershell
winget install --id Oven-sh.Bun -e
winget install --id Rustlang.Rustup -e
winget install --id GoLang.Go -e
winget install --id Google.Protobuf -e
winget install --id Microsoft.EdgeWebView2Runtime -e
```

安装 Rust 后执行：

```powershell
rustup default stable
```

如果这是第一次在 Windows 上编译 Rust/Tauri 项目，还需要安装 Visual Studio 2022 Build Tools，并勾选 `Desktop development with C++`。

安装完成后，重新打开终端，再检查：

```powershell
bun --version
rustc --version
cargo --version
go version
protoc --version
```

### 2. 安装项目依赖

```powershell
bun install --frozen-lockfile
```

### 3. 启动桌面开发模式

```powershell
bun run tauri dev
```

### 4. 构建桌面安装包

```powershell
bun run tauri build
```

## macOS 构建说明

### 1. 安装前置

先安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

如果使用 Homebrew，推荐安装：

```bash
brew install oven-sh/bun/bun go protobuf
```

安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

检查工具：

```bash
bun --version
rustc --version
cargo --version
go version
protoc --version
```

### 2. 安装项目依赖

```bash
bun install --frozen-lockfile
```

### 3. 启动桌面开发模式

```bash
bun run tauri dev
```

### 4. 构建桌面安装包

```bash
bun run tauri build
```

## Linux 构建说明

以下命令以 Ubuntu 22.04 为基准，与 CI 使用的系统依赖保持一致。

### 1. 安装系统依赖

```bash
sudo apt-get update
sudo apt-get install -y \
	build-essential \
	curl \
	file \
	golang-go \
	libayatana-appindicator3-dev \
	librsvg2-dev \
	libssl-dev \
	libwebkit2gtk-4.1-dev \
	libxdo-dev \
	patchelf \
	protobuf-compiler \
	wget
```

### 2. 安装 Bun 和 Rust

```bash
curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

安装完成后，重新打开终端，再检查：

```bash
bun --version
rustc --version
cargo --version
go version
protoc --version
```

### 3. 安装项目依赖

```bash
bun install --frozen-lockfile
```

### 4. 启动桌面开发模式

```bash
bun run tauri dev
```

### 5. 构建桌面安装包

```bash
bun run tauri build
```

## Web 测试启动（不通过 Tauri）

用于纯前端联调和页面调试：

1. 安装依赖

```bash
bun install --frozen-lockfile
```

2. 启动 Web 开发服务

```bash
bun run web:dev
```

3. 浏览器访问

```text
http://127.0.0.1:4173
```

4. 生产预览（可选）

```bash
bun run web:build
bun run web:preview
```

说明：

- `web:dev` 和 `web:preview` 不依赖 Tauri
- `tauri dev` 适合桌面容器联调

## 常用命令

```bash
bun run build:sidecar
bun run build
bun run test
bun run test:rust
bun run test:e2e
bun run tauri dev
bun run tauri build
```

## 常见问题

### `go: command not found`

说明 Go 未安装，或当前终端尚未加载最新 PATH。

### `Executable not found in $PATH: protoc`

说明 `protoc` 未安装，或安装后没有重新打开终端。

### `protoc-gen-go: The system cannot find the file specified`

通常是 sidecar 代码生成阶段失败。先执行：

```bash
bun run build:sidecar
```

如果仍失败，优先检查 `go`、`protoc` 和终端 PATH。

## 文档

- [插件开发教程](docs/plugin-development-guide.md)

## Release 构建

GitHub Actions 只会在你给某个 commit 打 tag 并 push tag 之后触发多平台打包，不会在普通 push 时执行 release 构建。

Release workflow 在真正开始多平台打包前，会先执行完整测试准入：

1. `bun run test`
2. `bun run test:rust`
3. `bun run test:e2e`
4. `bun run build`

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会在 GitHub Release 下构建并上传不同平台的安装包与压缩产物。

## CI

普通 push 和 pull request 会自动执行全量测试，不会自动执行 release 打包。

CI 覆盖：

1. `bun run test`
2. `bun run test:rust`
3. `bun run test:e2e`
4. `bun run build`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
