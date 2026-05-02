import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  optimizeDeps: {
    // TipTap is many small packages; pinning them avoids stale pre-bundle hashes (504 Outdated Optimize Dep)
    // after installs — restart dev after clearing node_modules/.vite if it happens again.
    include: [
      "@tiptap/core",
      // Do not list @tiptap/pm — it has no "." export (subpath-only); Vite cannot pre-bundle it.
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-link",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-underline",
    ],
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "robots.txt",
        "pwa-192.png",
        "pwa-512.png",
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
        "og-image.png",
      ],
      manifest: {
        id: "/",
        name: "Unified Inbox Hub — Unified inbox",
        short_name: "Inbox Hub",
        description: "Gmail and custom domain email in one dashboard.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        // Required so `virtual:pwa-register` resolves during `vite dev` (see main.tsx).
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
