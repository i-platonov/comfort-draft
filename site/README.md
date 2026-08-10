# Landing page — ufhdesigner.com

The marketing / SEO page. Plain static HTML: no build step, no dependencies, and no
external requests at all (CSS inlined, hero drawn as inline SVG, system fonts).

```
site/
  index.html      the page
  og-image.png    1200×630 social preview
  favicon.svg
  robots.txt
  sitemap.xml
  README.md       this file — not deployed
```

## Building

`npm run build` (from the repo root) assembles the whole site into `dist/`:

```
dist/
  index.html          ← site/index.html          served at /
  og-image.png
  favicon.svg
  robots.txt
  sitemap.xml
  app/
    index.html        ← the built design app     served at /app
    assets/…
```

It runs in three steps:

1. `tsc` — typecheck the app.
2. `scripts/build-site.mjs` — wipe `dist/` and copy `site/` into it. Wiping first is what
   keeps a page or image you deleted from `site/` out of the next deploy; it runs *before*
   the app build for that reason, since doing it afterwards would delete the app.
3. `vite build` — build the app into `dist/app`.

`vite.config.ts` sets `base: '/app/'`, so the app's asset URLs are written as
`/app/assets/…`. That applies to `npm run dev` too — the dev server serves on
<http://localhost:5173/app/>, matching production rather than letting a path bug hide
until deploy.

Other scripts: `npm run build:app` builds only the app into `dist/app`; `npm run preview`
serves the finished `dist/` the way a static host would, so you can click from the landing
page through to the app before deploying.

## Deploying

Both halves are static — upload `dist/` as-is. No server, no redirects, no rewrite rules:
`/app` resolves to `dist/app/index.html` because it is a real directory with a real
`index.html`.

| Host | Setting |
| --- | --- |
| **Cloudflare Pages** | build command `npm run build`, output directory `dist` |
| **Netlify** | build command `npm run build`, publish directory `dist` |
| **Vercel** | framework *Other*, build command `npm run build`, output directory `dist` |
| **GitHub Pages** | publish `dist/` to the `gh-pages` branch |

Point `ufhdesigner.com` at whichever you pick. Nothing needs to resolve `app.` — the app
is a path on the same origin, which also means the landing page and the app share one
certificate and one analytics property.

## After going live

- Verify the domain in [Google Search Console](https://search.google.com/search-console)
  and submit `https://ufhdesigner.com/sitemap.xml`.
- Check the markup with the [Rich Results Test](https://search.google.com/test/rich-results)
  — the page ships `SoftwareApplication` and `FAQPage` structured data, so the FAQ can
  appear expanded in results.
- `sitemap.xml` lists only `/`. That is deliberate: `/app` is an empty shell until
  JavaScript runs, so it is not worth pointing crawlers at, and you want the landing page
  to be what ranks. It is not blocked in `robots.txt`, so it can still be indexed if
  someone links to it.

## Editing

The hero illustration is **real output from the app's own spiral generator**, embedded as
inline SVG paths — not a drawing of one. To regenerate it after changing the routing code,
write a throwaway test that calls `generateSerpentine` for a few room shapes, dump each
result as an SVG path, and paste them into the two `<g>` groups in the hero. `og-image.png`
is rendered from the same data with `rsvg-convert`.

Two things to keep straight when editing copy:

- One `<h1>` only; sections are `<h2>`.
- The FAQ text in the page and in the `FAQPage` JSON-LD at the bottom of `<head>` must keep
  saying the same thing — Google treats a mismatch as cloaking.
