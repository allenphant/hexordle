import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// TUNNEL_HOST is set when developing through a cloudflare tunnel.
// Leave it empty in production (built files are served by the Express server).
const tunnelHost = process.env.TUNNEL_HOST;

export default defineConfig({
  plugins: [react()],
  envDir: "../../",
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    },
    allowedHosts: true,
    ...(tunnelHost
      ? {
          hmr: {
            clientPort: 443,
            host: tunnelHost,
            protocol: "wss",
          },
        }
      : {}),
  },
});
