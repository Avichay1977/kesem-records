// Shared helpers for the site QA suites (tests/static and tests/e2e).
// Node built-ins only, so the zero-dependency static tests can import it too.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Canonical production origin used in sitemap.xml, canonicals and structured data. */
export const SITE_ORIGIN = 'https://kesem-records.netlify.app';

const SITEMAP_FILE = fileURLToPath(new URL('../../public/sitemap.xml', import.meta.url));

/**
 * Every page listed in public/sitemap.xml as a site-relative path ('/', '/about/', ...).
 * Only plain <loc> elements count; <video:*_loc> entries are not pages.
 * Throws if a <loc> is outside SITE_ORIGIN, so tests never fall through to a foreign URL.
 * @returns {string[]}
 */
export function sitemapPaths() {
  const xml = readFileSync(SITEMAP_FILE, 'utf8');
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(([, loc]) => {
    if (!loc.startsWith(`${SITE_ORIGIN}/`)) {
      throw new Error(`sitemap.xml <loc> is not under ${SITE_ORIGIN}: ${loc}`);
    }
    return loc.slice(SITE_ORIGIN.length);
  });
}

/** Hostnames of the embedded YouTube / Spotify players that E2E runs must not load. */
export const PLAYER_HOSTS = Object.freeze([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'open.spotify.com',
]);

/**
 * Abort every request to PLAYER_HOSTS in this browser context so tests stay fast and
 * offline-safe. Everything else (local pages, images such as i.ytimg.com thumbnails,
 * Google Fonts) continues normally.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function blockThirdPartyPlayers(context) {
  await context.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return PLAYER_HOSTS.includes(hostname) ? route.abort() : route.continue();
  });
}

/** Absolute path of the pinned axe-core build, for page.addScriptTag({ path: AXE_PATH }). */
export const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** axe-core rule tags: WCAG 2.0 A/AA, WCAG 2.1 A/AA and WCAG 2.2 AA. */
export const WCAG_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
