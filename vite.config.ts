import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

/**
 * 将大型依赖拆分到稳定 chunk，避免主入口包过大。
 *
 * 说明：这里只对体积显著且边界清晰的依赖做手动拆分，
 * 避免生成过多碎片化 chunk 反而增加加载开销。
 */
function getNodeModulesPackageName(id: string): string | null {
  const normalizedId = id.split("?")[0].replace(/\\/g, "/");
  const marker = "/node_modules/";
  const markerIndex = normalizedId.lastIndexOf(marker);

  if (markerIndex < 0) {
    return null;
  }

  const packagePath = normalizedId.slice(markerIndex + marker.length);
  if (packagePath.startsWith(".")) {
    return null;
  }

  const segments = packagePath.split("/");
  if (segments[0]?.startsWith("@") && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }

  return segments[0] ?? null;
}

function resolveManualChunk(id: string): string | undefined {
  const normalizedId = id.split("?")[0].replace(/\\/g, "/");

  if (normalizedId.includes("/src/plugins/markdown-codemirror/")) {
    return "markdown-editor";
  }

  if (normalizedId.includes("/src/plugins/knowledge-graph/")) {
    return "knowledge-graph-feature";
  }

  if (normalizedId.includes("/src/plugins/file-tree/")) {
    return "file-tree-feature";
  }

  if (normalizedId.includes("/src/api/")) {
    return "vault-api";
  }

  if (normalizedId.includes("/src/host/store/") || normalizedId.includes("/src/host/events/")) {
    return "host-state";
  }

  if (normalizedId.includes("/src/host/layout/") || normalizedId.includes("/src/host/registry/")) {
    return "layout-host";
  }

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  const packageName = getNodeModulesPackageName(id);
  if (!packageName) {
    return undefined;
  }

  if (
    packageName.startsWith("@codemirror")
    || packageName.startsWith("@lezer")
    || packageName === "codemirror"
    || packageName === "@replit/codemirror-vim"
  ) {
    return "codemirror";
  }

  if (packageName === "@cosmos.gl/graph") {
    return "knowledge-graph-vendor";
  }

  if (packageName === "dockview" || packageName === "dockview-core") {
    return "dockview-vendor";
  }

  if (packageName === "katex") {
    return "katex-vendor";
  }

  if (packageName === "highlight.js") {
    return "highlight-vendor";
  }

  if (["react", "react-dom", "scheduler"].includes(packageName)) {
    return "react-vendor";
  }

  if (["i18next", "react-i18next", "yaml"].includes(packageName)) {
    return "i18n-vendor";
  }

  if (packageName.startsWith("@tauri-apps")) {
    return "tauri-vendor";
  }

  return "vendor-misc";
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  optimizeDeps: {
    // layout-v2 is linked via `file:../layout-v2`; excluding it avoids stale
    // optimized-dep caches after local rebuilds during tauri dev restarts.
    exclude: ["layout-v2"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
}));
