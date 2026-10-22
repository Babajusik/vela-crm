import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE || '/',
    plugins: [react(), tailwindcss()],
    // keep logical paths: on Windows app-container folders realpath() points to a location the dev server cannot read
    resolve: { preserveSymlinks: true },
    server: {
      port: 5173,
      proxy: env.VITE_ENGINE === 'http' ? { '/api': 'http://localhost:3000' } : undefined,
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] },
        },
      },
    },
  };
});
