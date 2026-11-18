# Site QA tests

Automated checks for the Kesem Records site. They replace the manual QA pass.

GitHub Actions runs them in the **Site QA** workflow (`.github/workflows/site-qa.yml`) on every pull request, on every push to `master`, and on demand from the Actions tab (**Run workflow**). The workflow is a quality gate only: Netlify deploys `master` by itself, and CI never deploys anything. A direct push to `master` deploys even if the run fails, so to block merges, mark the `qa` check as required in the branch protection rules for `master`.

| Suite | Command | Files | How it runs |
| --- | --- | --- | --- |
| Static | `npm run test:static` | `tests/static/*.test.mjs` | Node's built-in test runner reads the site files. No browser, no server. |
| End-to-end (E2E) | `npm run test:e2e` | `tests/e2e/*.spec.mjs` | Playwright serves the build with `astro preview` on `127.0.0.1:4321` and drives Chromium. |

`npm test` runs both, static first. Shared helpers (sitemap page list, player blocking, axe settings) are in `tests/helpers/site.mjs`. E2E settings are in `playwright.config.mjs`.

## What the suites check

### Static

- **Sitemap**: `public/sitemap.xml` and the pages it lists.
- **Canonical URLs**
- **`noindex`**
- **JSON-LD**: every block is valid, and facts shared between pages agree.
- **VideoObject**: structured-data rules for videos, such as no YouTube watch-page `contentUrl`.
- **iframe titles**: every embedded player has a `title`.
- **Internal links**: no broken links between pages.
- **Social image**: the share image used for link previews.
- **robots.txt and llms.txt**
- **Security headers**: `public/_headers`.

### End-to-end

- **Accessibility**: WCAG 2.2 A and AA rules through axe-core on every page in the sitemap. axe-core finds only machine-detectable problems; keyboard and screen-reader checks still need a person.
- **Layout**: no horizontal scrolling at 320, 390 and 1366 px viewport widths.
- **Runtime**: no page errors.
- **Home heading**: the home page H1 never breaks inside a word.
- **Catalogue**: section counters, search, filters, players, the no-JavaScript fallback and the skip link.
- **404 page**: an unknown URL returns HTTP 404 with the custom page, `noindex` and valid JSON-LD, plus the same accessibility, layout and runtime checks. It is the only page Astro builds (`src/pages/404.astro`), so these checks also guard Astro upgrades.

## Run locally

From the repository root, with the Node version in `.nvmrc` (Node 22; Astro 7 needs 22.23.4 or later). CI reads the same file, and so does Netlify unless a `NODE_VERSION` variable is set in its settings.

```sh
npm ci
npx playwright install chromium   # first time, and after every Playwright upgrade
npm run build                     # E2E serves dist/, so rebuild after every change
npm test
```

- One suite: `npm run test:static` or `npm run test:e2e`. One file: `npx playwright test tests/e2e/catalogue.spec.mjs`.
- `npx playwright show-report` opens the HTML report of the last E2E run (`playwright-report/`).
- Locally, Playwright reuses any server that already answers on port 4321. Stop `npm run dev` first (Astro's dev server also uses 4321), or choose another port: `SITE_QA_PORT=4400 npm run test:e2e` (bash) or `$env:SITE_QA_PORT=4400; npm run test:e2e` (PowerShell).
- On Linux, use `npx playwright install --with-deps chromium` if Chromium is missing system libraries. CI does this.

## When CI fails

1. Open the failed **Site QA** run from the pull request's checks or from the repository's **Actions** tab.
2. The red step names the stage: install, build, static checks or end-to-end tests. Its log names the failing test and assertion.
3. For E2E failures, download the **playwright-report** artifact from the run's summary page (kept for 7 days). Unzip it and run `npx playwright show-report <unzipped-folder>`. Each failed test shows its error and a step-by-step trace.
4. CI retries a failed E2E test once. A test that passes on the retry is counted as flaky in the log and does not fail the run. Fix it anyway.
5. Reproduce with the same commands locally.

A failing check usually means a real regression in the site. Fix the site, not the test, unless the test itself is wrong.

## Maintenance

- **Adding or removing a release.** In the same change, update both files, or the count-consistency tests fail:
  - `public/index.html`: each catalogue section's counter (`data-kc-section-count`, e.g. `15 releases`) and the total in the `data-kc-status` line (e.g. `33 releases`). Visitors without JavaScript see these texts as written; the catalogue script recounts them from the release cards.
  - `public/llms.txt`: the release count. It appears twice, in the English link list and in the Hebrew section.
- **Third-party players are blocked.** The E2E tests abort requests to YouTube (`www.youtube.com`, `youtube.com`, `www.youtube-nocookie.com`) and Spotify (`open.spotify.com`), so no result depends on those services. Player tests check the site's own player behaviour, not the embedded media.
- **New pages.** The E2E checks run on the pages listed in `public/sitemap.xml`. A page missing from the sitemap is not tested, except the 404 page, which has its own checks.
- **Pinned versions.** `@playwright/test` (1.63.0) and `axe-core` (4.10.2) are pinned exactly. After a Playwright upgrade, run `npx playwright install chromium` again.
