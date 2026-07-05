import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    global: 'globalThis',
    'process.env': {}
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000
  }
});
