// @ts-check
/**
 * Accessibility, layout and runtime checks for every page in public/sitemap.xml,
 * run against the production build (`astro preview` serves dist/).
 *
 * Every check opens its page in a fresh browser context with its own viewport, aborts the
 * embedded YouTube and Spotify players, then waits for the load event, for web fonts and
 * for finite entrance animations, so a result never depends on timing or on those services.
 */
import { test as base, expect } from '@playwright/test';
import { AXE_PATH, WCAG_TAGS, blockThirdPartyPlayers, sitemapPaths } from '../helpers/site.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ width: number, height: number }} Viewport */
/**
 * Opens `path` in a fresh context with `viewport`. `beforeGoto` runs before navigation,
 * for event listeners. The page is returned loaded, with fonts and animations settled.
 * @typedef {(path: string, viewport: Viewport, options?: { beforeGoto?: (page: Page) => void }) => Promise<Page>} OpenPage
 */

/** @type {Viewport} */
const A11Y_VIEWPORT = { width: 390, height: 844 };
/** @type {Viewport[]} */
const LAYOUT_VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 1366, height: 900 },
];
/** @type {Viewport} */
const RUNTIME_VIEWPORT = { width: 1366, height: 900 };
/** @type {Viewport[]} Home page H1 check; 360 px is the most common Android width. */
const HEADING_VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];
/** Words shorter than this may wrap without looking broken. */
const MIN_WORD_LENGTH = 6;
/** Longest wait for entrance animations to finish before measuring anyway. */
const ANIMATION_WAIT_MS = 5_000;

/** @param {Viewport} viewport */
const size = ({ width, height }) => `${width}x${height}`;

/**
 * @type {import('@playwright/test').Fixtures<
 *   { openPage: OpenPage }, {},
 *   import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions,
 *   import('@playwright/test').PlaywrightWorkerArgs & import('@playwright/test').PlaywrightWorkerOptions
 * >}
 */
const fixtures = {
  // Every context opened by a test is closed when the test ends, pass or fail.
  openPage: async ({ browser, baseURL }, use) => {
    /** @type {import('@playwright/test').BrowserContext[]} */
    const contexts = [];
    await use(async (path, viewport, { beforeGoto } = {}) => {
      const context = await browser.newContext({ baseURL, viewport });
      contexts.push(context);
      await blockThirdPartyPlayers(context);
      const page = await context.newPage();
      beforeGoto?.(page);
      await page.goto(path, { waitUntil: 'load' });
      await page.evaluate(settle, ANIMATION_WAIT_MS);
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
};
const test = base.extend(fixtures);

test.describe.configure({ mode: 'parallel' });

for (const path of sitemapPaths()) {
  test.describe(`page ${path}`, () => {
    test(`accessibility: no WCAG A/AA violations at ${size(A11Y_VIEWPORT)} (axe-core)`, async ({ openPage }) => {
      const page = await openPage(path, A11Y_VIEWPORT);
      // Main document only: the blocked player iframes get no axe-core and are not analysed.
      await page.addScriptTag({ path: AXE_PATH });
      const violations = await page.evaluate(runAxe, [...WCAG_TAGS]);
      expect(violations.map(formatViolation), `axe-core found WCAG A/AA violations on ${path}`).toEqual([]);
    });

    for (const viewport of LAYOUT_VIEWPORTS) {
      test(`layout: no horizontal overflow at ${size(viewport)}`, async ({ openPage }) => {
        const page = await openPage(path, viewport);
        const { overflow, offenders } = await page.evaluate(measureOverflow);
        const widest = offenders.map((o) => `\n  ${o.element}: ${o.width}px wide, left ${o.left}px, right ${o.right}px`);
        expect(
          overflow,
          `Page ${path} is ${overflow}px wider than the ${viewport.width}px viewport. ` +
            `Widest offending elements:${widest.join('') || ' none found'}`,
        ).toBeLessThanOrEqual(0);
      });
    }

    test(`runtime: no page errors or first-party HTTP errors at ${size(RUNTIME_VIEWPORT)}`, async ({ openPage, baseURL }) => {
      const siteOrigin = new URL(String(baseURL)).origin;
      /** @type {string[]} */
      const pageErrors = [];
      /** @type {string[]} */
      const httpErrors = [];
      await openPage(path, RUNTIME_VIEWPORT, {
        beforeGoto(page) {
          page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
          page.on('response', (response) => {
            // Third-party failures (fonts, thumbnails, blocked players) are out of scope.
            if (response.status() >= 400 && new URL(response.url()).origin === siteOrigin) {
              httpErrors.push(`${response.status()} ${response.url()}`);
            }
          });
        },
      });
      expect({ pageErrors, httpErrors }, `Uncaught errors or first-party HTTP errors while loading ${path}`).toEqual({
        pageErrors: [],
        httpErrors: [],
      });
    });
  });
}

test.describe('home page H1', () => {
  for (const viewport of HEADING_VIEWPORTS) {
    test(`no word of ${MIN_WORD_LENGTH}+ characters is split across lines at ${viewport.width}px`, async ({ openPage }) => {
      const page = await openPage('/', viewport);
      const headings = await page.locator('h1').evaluateAll(findSplitWords, MIN_WORD_LENGTH);
      expect(headings.length, 'the home page has an <h1>').toBeGreaterThan(0);
      for (const { text, fontSize, splitWords } of headings) {
        expect(splitWords, `<h1> "${text}" at ${viewport.width}px, font-size ${fontSize}: words split across lines`).toEqual([]);
      }
    });
  }
});

/**
 * @param {{ id: string, impact?: string | null, nodes: number, targets: string[] }} violation
 */
function formatViolation({ id, impact, nodes, targets }) {
  const more = nodes > targets.length ? ' | …' : '';
  return `${id} [${impact ?? 'no impact'}] ${nodes} node(s): ${targets.join(' | ')}${more}`;
}

// The functions below run inside the page (page.evaluate), so they use nothing from this module.

/**
 * Waits for web fonts, then lets every running finite animation (entrance effects) finish,
 * for at most `maxWaitMs`. Infinite animations, such as a blinking cursor, are not awaited.
 * @param {number} maxWaitMs
 */
async function settle(maxWaitMs) {
  await document.fonts.ready;
  const finite = document
    .getAnimations()
    .filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime));
  await Promise.race([
    Promise.allSettled(finite.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

/**
 * Runs the injected axe-core on the main document and summarises each violated rule.
 * @param {string[]} tags
 */
async function runAxe(tags) {
  const axe = /** @type {typeof import('axe-core')} */ (/** @type {any} */ (window).axe);
  const { violations } = await axe.run(document, {
    runOnly: { type: 'tag', values: tags },
    resultTypes: ['violations'],
  });
  return violations.map((rule) => ({
    id: rule.id,
    impact: rule.impact,
    nodes: rule.nodes.length,
    targets: rule.nodes.slice(0, 3).map((node) => node.target.flat().join(' >>> ')),
  }));
}

/**
 * Horizontal overflow of the document in px, plus the 3 widest visible elements that stick
 * out of the viewport on the scrollable side (right, or left for a right-to-left page).
 * Elements clipped by a scrolling or overflow-hidden ancestor, or inside a fixed element,
 * cannot widen the page and are listed only when nothing else is found.
 */
function measureOverflow() {
  const viewportWidth = window.innerWidth;
  const overflow = document.documentElement.scrollWidth - viewportWidth;
  if (overflow <= 0) return { overflow, offenders: [] };

  const rtl = getComputedStyle(document.body ?? document.documentElement).direction === 'rtl';
  const sticksOut = (/** @type {DOMRect} */ r) => r.width > 0 && (rtl ? r.left < -0.5 : r.right > viewportWidth + 0.5);
  const candidates = [...document.querySelectorAll('body, body *')].filter((el) => {
    const { visibility } = getComputedStyle(el);
    return visibility !== 'hidden' && visibility !== 'collapse' && sticksOut(el.getBoundingClientRect());
  });
  const contained = (/** @type {Element} */ el) => {
    for (let node = el; node && node !== document.body; node = /** @type {Element} */ (node.parentElement)) {
      const style = getComputedStyle(node);
      if (style.position === 'fixed' || (node !== el && style.overflowX !== 'visible')) return true;
    }
    return false;
  };
  const uncontained = candidates.filter((el) => !contained(el));
  return {
    overflow,
    offenders: (uncontained.length ? uncontained : candidates)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const classes = [...el.classList].slice(0, 3).map((c) => `.${c}`).join('');
        return {
          element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}`,
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      })
      .sort((a, b) => b.width - a.width)
      .slice(0, 3),
  };
}

/**
 * For each heading: the words of at least `minLength` characters (letters, marks, digits)
 * whose glyphs sit on more than one line, measured with one Range per word.
 * @param {Element[]} headings
 * @param {number} minLength
 */
function findSplitWords(headings, minLength) {
  return headings.map((heading) => {
    /** @type {string[]} */
    const splitWords = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = /** @type {Text} */ (node);
      for (const match of text.data.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
        if ([...match[0]].length < minLength) continue;
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const lineTops = new Set(
          [...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)),
        );
        if (lineTops.size > 1) splitWords.push(match[0]);
      }
    }
    return {
      text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
      fontSize: getComputedStyle(heading).fontSize,
      splitWords,
    };
  });
}
