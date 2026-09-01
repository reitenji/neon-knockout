import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: false },
  server: {
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:4173', ws: true },
      '/health': { target: 'http://127.0.0.1:4173' },
      '/api': { target: 'http://127.0.0.1:4173' }
    }
  }
});
