import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Falcon renderer build. `base: './'` is required because the packaged app is
// loaded from the file:// protocol inside Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
});
