/**
 * @module plugins/file-tree
 * @description 文件树插件公共导出：为宿主或其他模块暴露该插件允许被引用的稳定类型与组件。
 * @dependencies
 *   - ./panel/FileTree
 *   - ./panel/VaultPanel
 */

export { FileTree } from "./panel/FileTree";
export type { FileTreeItem } from "./panel/FileTree";
export { VaultPanel } from "./panel/VaultPanel";