import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  // WEB_HOST opens the dev server to the network (e.g. "0.0.0.0"); it never
  // changes where the API itself listens.
  const apiHost = env.API_HOST ?? "127.0.0.1";
  const target = `http://${apiHost === "0.0.0.0" ? "127.0.0.1" : apiHost}:${env.API_PORT ?? "3000"}`;
  return {
    plugins: [vue(), tailwindcss()],
    server: {
      host: env.WEB_HOST ?? "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": target, "/health": target },
    },
  };
});
