# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Web 测试启动（不通过 Tauri）

用于纯前端联调和页面调试：

1. 安装依赖

	npm install

2. 启动 Web 开发服务

	npm run web:dev

3. 浏览器访问

	http://127.0.0.1:4173

4. 生产预览（可选）

	npm run web:build
	npm run web:preview

说明：
- `web:dev` / `web:preview` 完全不依赖 tauri 命令。
- `tauri dev` 仍可用于桌面容器联调，两者互不影响。

## 文档

- [插件开发教程](docs/plugin-development-guide.md)

## Release 构建

GitHub Actions 只会在你给某个 commit 打 tag 并 push tag 之后触发多平台打包，不会在普通 push 时执行 release 构建。

Release workflow 在真正开始多平台打包前，会先执行完整测试准入：

1. `bun test`
2. `cargo test --manifest-path src-tauri/Cargo.toml`
3. `bunx playwright test`
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

1. `bun test`
2. `cargo test --manifest-path src-tauri/Cargo.toml`
3. `bunx playwright test`
4. `bun run build`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
