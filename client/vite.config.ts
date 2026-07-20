import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = parseInt(process.env['PORT'] ?? '4123', 10);

export default defineConfig({
  plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
  server: {
    port,
    host: '127.0.0.1',
    open: false,
    strictPort: true,
  },
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          phaser: ['phaser'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'phaser'],
    exclude: ['monaco-editor'],
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
  },
  define: {
    // CRA compat — replace process.env.NODE_ENV with Vite equivalent
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
});
