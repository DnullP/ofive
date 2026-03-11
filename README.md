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

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
