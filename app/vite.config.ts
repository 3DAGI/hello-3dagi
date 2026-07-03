import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// web3.js and wallet adapters expect some node globals in the browser.
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },
  build: {
    target: 'es2020',
  },
});
