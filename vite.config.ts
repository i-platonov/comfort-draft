import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The app is served from /app on ufhdesigner.com — the landing page in `site/` takes the
 * root. `base` makes Vite write its asset URLs with that prefix, and `outDir` puts the
 * build straight into the subdirectory of `dist/` it is served from, so `npm run build`
 * produces the deployable tree in one shape:
 *
 *   dist/            the landing page (copied from site/)
 *   dist/app/        this app
 *
 * `base` applies to the dev server too, so `npm run dev` serves on /app exactly as
 * production does rather than letting a path bug hide until deploy.
 */
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
  },
});
