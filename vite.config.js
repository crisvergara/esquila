import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// LAN build: tagger + monitors, served by countserver.js.
// EsquilaDB moved to the cloud origin — see vite.cloud.config.js.
export default defineConfig(() => {
  return {
    build: {
      outDir: 'build',
      rollupOptions: {
        input: {
          main: './index.html',
          tagger: './tagger/index.html',
          monitor: './monitor/index.html',
          mobilemonitor: './mobilemonitor/index.html',
        },
      },
    },
    publicDir: 'public',
    plugins: [react()],
    server: {
      proxy: {
        '/count': 'http://localhost:3001',
        '/mode': 'http://localhost:3001',
        '/sse': 'http://localhost:3001',
        '/bulk': 'http://localhost:3001',
      },
    },
  };
});
