import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The app is served at the domain root (co-draft.eu) with no separate landing page,
 * so it builds straight into dist/ with no path prefix.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
