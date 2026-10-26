#!/usr/bin/env node
/**
 * Falcon Electron derleyicisi.
 * Main + preload dosyalarını CommonJS olarak paketler (Electron'da en sorunsuz mod).
 * Renderer Vite tarafından ayrıca derlenir.
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const watch = process.argv.includes('--watch');

const options = {
  absWorkingDir: root,
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
  },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  external: ['electron', 'mammoth'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build:electron] izleme modunda');
} else {
  await build(options);
  console.log('[build:electron] tamamlandı → dist-electron/');
}
