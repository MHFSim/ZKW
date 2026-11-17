import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade: funktioniert auf GitHub Pages unter jedem Repo-Namen
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
  },
  worker: { format: 'es' },
  server: { host: true },
});
