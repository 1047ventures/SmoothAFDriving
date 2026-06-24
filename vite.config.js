import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Copy static assets that Vite doesn't process automatically
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
    },
  },
});
