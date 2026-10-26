import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Falcon renderer build. `base: './'` keeps asset yolları göreli; paketlenmiş
// uygulama dosyaları app://falcon/index.html üzerinden yükler.
// allowedHosts: uzaktaki önizleme (e2b.app) ve yerel ağ erişimi için.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', 'localhost'],
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', 'localhost'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
});
