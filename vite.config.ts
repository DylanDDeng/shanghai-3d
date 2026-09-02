import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Cesium looks for its static assets (Workers/Assets/Widgets) at this URL. See scripts/copy-cesium.mjs.
    CESIUM_BASE_URL: JSON.stringify(process.env.CESIUM_BASE_URL ?? '/cesium/'),
  },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/cesium') || id.includes('node_modules/@cesium')) return 'cesium';
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
