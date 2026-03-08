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
          vaccinator: './vaccinator/index.html',
        },
      },
    },
    publicDir: 'public',
    plugins: [react()],
  };
});