import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const singletonDependencies = [
  "@codemirror/autocomplete",
  "@codemirror/commands",
  "@codemirror/lang-markdown",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/highlight",
  "codemirror",
  "react",
  "react-dom",
  "react/jsx-runtime",
];

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Tauri loads bundled files through a custom packaged-app protocol, so root
  // paths like /assets/app.js can work in dev yet fail after installation.
  // `bun run check:tauri-frontend-assets` keeps this packaged asset contract
  // from regressing after every production build.
  base: "./",
  plugins: [react()],
  resolve: {
    dedupe: singletonDependencies,
  },
  optimizeDeps: {
    // Sibling packages are linked via local file dependencies; excluding them
    // avoids stale optimized-dep caches after local rebuilds during dev restarts.
    exclude: ["layout-v2", "obeditor"],
    // Mermaid is consumed through the linked obeditor build and imports the CJS
    // dayjs entry directly; prebundling keeps the browser mock runtime ESM-safe.
    include: [
      "mermaid",
      "dayjs",
      "dayjs/plugin/advancedFormat.js",
      "dayjs/plugin/customParseFormat.js",
      "dayjs/plugin/duration.js",
      "dayjs/plugin/isoWeek.js",
    ],
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
    // Keep Rollup's default chunk graph unless a future change can prove the
    // production preview smoke still mounts. A previous manualChunks split of
    // CodeMirror/editor/layout modules produced a production-only TDZ error
    // (`Cannot access ... before initialization`) and left the packaged app
    // as a white screen even though `tauri dev` was healthy.
    chunkSizeWarningLimit: 900,
  },
}));
