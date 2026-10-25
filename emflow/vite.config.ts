// vite.config.ts
//
// `npm run build` produces a self-contained UMD library (React included):
//   dist/emflow.js   -> global `EMFlow` (EMFlow.mountProjectPage(...))
//   dist/emflow.css  -> all rules scoped under `.emflow-root`
import path from "path";
import { readFileSync } from "fs";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    svgr({
      svgrOptions: { icon: true, exportType: "named", namedExport: "ReactComponent" },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  css: {
    modules: {
      // Hashed and prefixed class names for *.module.css
      generateScopedName: "emflow_[local]_[hash:base64:6]",
    },
  },
  define: {
    // Libraries reference process.env.NODE_ENV, which does not exist in browsers
    ...(command === "build" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {}),
    __EMFLOW_VERSION__: JSON.stringify(pkg.version),
    __EMFLOW_BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: "esbuild",
    target: "es2018",
    cssCodeSplit: false,
    // Inline fonts/images in the bundle so only two files need to be copied
    assetsInlineLimit: 1024 * 1024,
    chunkSizeWarningLimit: 12000,
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      name: "EMFlow",
      formats: ["umd"],
      fileName: () => "emflow.js",
      cssFileName: "emflow",
    },
    rollupOptions: {
      // Everything (React included) is bundled: EMhub does not provide React
      external: [],
      output: {
        exports: "named",
        inlineDynamicImports: true,
      },
    },
  },
}));
