import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
          esquiladb: './esquiladb/index.html',
        },
      },
    },
    publicDir: 'public',
    plugins: [react()],
    server: {
      proxy: {
        '/sheep': 'http://localhost:3001',
        '/vaccinate': 'http://localhost:3001',
        '/treatments': 'http://localhost:3001',
        '/treatment-counts': 'http://localhost:3001',
        '/count': 'http://localhost:3001',
        '/mode': 'http://localhost:3001',
        '/sse': 'http://localhost:3001',
        '/bulk': 'http://localhost:3001',
      },
    },
  };
});