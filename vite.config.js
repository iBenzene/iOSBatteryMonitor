import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    build: {
        emptyOutDir: true,
        outDir: "dist",
    },
    plugins: [vue()],
    root: "ui",
    server: {
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:8765",
        },
    },
});
