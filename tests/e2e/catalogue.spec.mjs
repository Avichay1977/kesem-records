// E2E checks of the home page catalogue: counts, search, filters, players, the no-JavaScript
// fallback and the skip link. Expected values come from the served page itself (the release
// cards), so adding or removing a release needs no edit here; tests/README.md lists the files
// whose counts must change with it.
// YouTube and Spotify requests are blocked, so player tests check DOM state, never playback.
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { blockThirdPartyPlayers } from '../helpers/site.mjs';

const VIEWPORT = Object.freeze({ width: 1366, height: 900 });
const LLMS_TXT = new URL('../../public/llms.txt', import.meta.url);

const CARD = '[data-kc-release]';
const VISIBLE_CARD = `${CARD}:visible`;
const STATUS = '[data-kc-status]';
const NO_MATCH = 'zzqx-no-match';
const YOUTUBE_EMBED = /^https:\/\/www\.youtube-nocookie\.com\/embed\//;
const SPOTIFY_EMBED = /^https:\/\/open\.spotify\.com\/embed\//;
const PLAYING = /\bkc-playing\b/;
const HEBREW_LETTER = /[\u05D0-\u05EA]/;

const test = base.extend({
  // openHome() opens '/' in a fresh 1366x900 context with the players blocked before navigation.
  // Every context it creates is closed when the test ends.
  openHome: async ({ browser, baseURL }, use) => {
    const contexts = [];
    await use(async ({ javaScriptEnabled = true } = {}) => {
      const context = await browser.newContext({ baseURL, viewport: VIEWPORT, javaScriptEnabled });
      contexts.push(context);
      await blockThirdPartyPlayers(context);
      const page = await context.newPage();
      await page.goto('/');
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

/** "15 releases" or "1 release" -> 15 or 1. Any other wording fails the test. */
function releaseNumber(text) {
  const match = /^\s*(\d+) releases?\s*$/.exec(text ?? '');
  expect(match, `expected "<number> releases", got ${JSON.stringify(text)}`).not.toBeNull();
  return Number(match[1]);
}

/** For each section panel: its name, the number its counter shows, its cards, visible cards, empty state. */
async function sectionCounts(page) {
  const panels = await page.locator('[data-kc-section-panel]').all();
  expect(panels.length, 'the catalogue has section panels').toBeGreaterThan(0);
  const sections = [];
  for (const panel of panels) {
    const name = await panel.getAttribute('data-kc-section-panel');
    const counter = panel.locator('[data-kc-section-count]');
    await expect(counter, `section "${name}" has one counter`).toHaveCount(1);
    sections.push({
      name,
      counter: releaseNumber(await counter.textContent()),
      cards: await panel.locator(CARD).count(),
      visible: await panel.locator(VISIBLE_CARD).count(),
      emptyShown: await panel.locator('[data-kc-empty]').isVisible(),
    });
  }
  return sections;
}

/** Waits until the catalogue script has run (status "<N> of <N> releases") and returns N. */
async function catalogueReady(page) {
  const total = await page.locator(CARD).count();
  expect(total, 'the home page lists release cards').toBeGreaterThan(0);
  await expect(page.locator(STATUS)).toHaveText(`${total} of ${total} releases`);
  return total;
}

/** Expands the <details> around the search form if it is collapsed, then returns the form. */
async function openControls(page) {
  for (const details of await page.locator('details:has([data-kc-controls])').all()) {
    if (!(await details.evaluate((element) => element.open))) {
      await details.locator('summary').first().click();
    }
  }
  const form = page.locator('[data-kc-controls]');
  await expect(form).toBeVisible();
  return form;
}

/** The status line, section counters and empty states agree with the visible cards. Returns that count. */
async function expectCountsMatchVisibleCards(page, total) {
  const visible = await page.locator(VISIBLE_CARD).count();
  await expect(page.locator(STATUS)).toHaveText(`${visible} of ${total} releases`);
  for (const section of await sectionCounts(page)) {
    expect(section.counter, `section "${section.name}" counter`).toBe(section.visible);
    expect(section.emptyShown, `section "${section.name}" empty state shown`).toBe(section.visible === 0);
  }
  return visible;
}

/** The release card that contains `element`, located by its data-kc-release id. */
async function cardOf(page, element) {
  const id = await element.evaluate((el) => el.closest('[data-kc-release]')?.getAttribute('data-kc-release'));
  expect(id, 'the button sits inside a release card').toBeTruthy();
  return { id, card: page.locator(`[data-kc-release="${id}"]`) };
}

test.describe('home catalogue', () => {
  test('section counters, status line and llms.txt agree on the release count', async ({ openHome }) => {
    const page = await openHome();
    const total = await catalogueReady(page);

    const sections = await sectionCounts(page);
    for (const section of sections) {
      expect(section.counter, `section "${section.name}" counter`).toBe(section.cards);
    }
    expect(sum(sections.map((section) => section.counter)), 'section counters add up to all releases').toBe(total);

    const llms = readFileSync(LLMS_TXT, 'utf8');
    expect(llms, 'public/llms.txt states the catalogue size').toContain(`${total} releases`);
    const claims = [...llms.matchAll(/(\d+)\s+(?:releases?|הוצאות)/g)].map((match) => Number(match[1]));
    expect(
      claims.filter((claim) => claim !== total),
      `release counts in public/llms.txt (English and Hebrew) that are not ${total}`,
    ).toEqual([]);
  });

  test('without JavaScript every release is listed and the static counts are right', async ({ openHome }) => {
    const page = await openHome({ javaScriptEnabled: false });
    const total = await page.locator(CARD).count();
    expect(total, 'the home page lists release cards').toBeGreaterThan(0);

    await expect(page.locator(STATUS), 'static data-kc-status text in public/index.html').toHaveText(
      `${total} releases`,
    );
    const sections = await sectionCounts(page);
    for (const section of sections) {
      expect(section.counter, `static "${section.name}" counter in public/index.html`).toBe(section.cards);
      expect(section.emptyShown, `section "${section.name}" empty state shown`).toBe(false);
    }
    expect(sum(sections.map((section) => section.counter)), 'static section counters add up to all releases').toBe(
      total,
    );
    await expect(page.locator(VISIBLE_CARD)).toHaveCount(total);
    // Controls that need the script stay hidden.
    await expect(page.locator('[data-kc-controls]')).toBeHidden();
    await expect(page.locator('[data-kc-filters]:visible')).toHaveCount(0);
  });

  test('search finds English and Hebrew terms, shows empty states, and reset clears every filter', async ({
    openHome,
  }) => {
    const page = await openHome();
    const total = await catalogueReady(page);
    const form = await openControls(page);
    const search = form.locator('#kc-search');
    const cards = page.locator(CARD);
    const allTerms = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-kc-search') ?? ''));

    // Searching for `word` must keep card `index` visible and, unless every card contains the
    // word, hide at least one card (a search that ignores the word would show everything).
    const expectSearchFinds = async (word, index) => {
      await expect(cards.nth(index)).toBeVisible();
      const visible = await expectCountsMatchVisibleCards(page, total);
      const lower = word.toLowerCase();
      if (!allTerms.every((terms) => terms.toLowerCase().includes(lower))) {
        expect(visible, `searching "${word}" narrows the list`).toBeLessThan(total);
      }
    };

    await test.step('a term from the first card keeps it visible, in any letter case', async () => {
      const words = allTerms[0].split(/\s+/).filter(Boolean);
      const token = words.find((word) => /^[a-z0-9]{3,}$/i.test(word)) ?? words[0];
      expect(token, 'the first card has search terms').toBeTruthy();
      await search.fill(token);
      await expectSearchFinds(token, 0);
      await search.fill(token.toUpperCase());
      await expectSearchFinds(token, 0);
    });

    await test.step(`"${NO_MATCH}" hides every card and shows the empty states`, async () => {
      await search.fill(NO_MATCH);
      await expect(page.locator(VISIBLE_CARD)).toHaveCount(0);
      await expect(page.locator(STATUS)).toHaveText(`0 of ${total} releases`);
      const empties = page.locator('[data-kc-empty]');
      expect(await empties.count(), 'the catalogue has empty-state messages').toBeGreaterThan(0);
      for (const empty of await empties.all()) await expect(empty).toBeVisible();
      await expectCountsMatchVisibleCards(page, total);
    });

    await test.step('a Hebrew term keeps its release visible', async () => {
      const index = allTerms.findIndex((terms) => terms.split(/\s+/).some((word) => HEBREW_LETTER.test(word)));
      expect(index, 'at least one release has Hebrew search terms').toBeGreaterThanOrEqual(0);
      const word = allTerms[index].split(/\s+/).find((term) => HEBREW_LETTER.test(term));
      await search.fill(word);
      await expectSearchFinds(word, index);
    });

    await test.step('reset clears the search, artist and section filters', async () => {
      const artist = form.locator('#kc-artist');
      await artist.selectOption({ index: 1 });
      await page.locator('[data-kc-filters] button[data-kc-filter]:not([data-kc-filter="all"])').first().click();
      await form.locator('button[type="reset"]').click();
      await expect(page.locator(STATUS)).toHaveText(`${total} of ${total} releases`);
      await expect(search).toHaveValue('');
      await expect(artist).toHaveValue('');
      await expect(page.locator(VISIBLE_CARD)).toHaveCount(total);
      for (const all of await page.locator('[data-kc-filters] button[data-kc-filter="all"]').all()) {
        await expect(all).toHaveAttribute('aria-pressed', 'true');
      }
      await expectCountsMatchVisibleCards(page, total);
    });
  });

  test('each filter is the only pressed button in its group and its section counter matches', async ({
    openHome,
  }) => {
    const page = await openHome();
    const total = await catalogueReady(page);
    const reset = (await openControls(page)).locator('button[type="reset"]');
    const buttons = await page.locator('[data-kc-filters] button[data-kc-filter]').all();
    expect(buttons.length, 'the catalogue has filter buttons').toBeGreaterThan(0);

    for (const button of buttons) {
      const key = await button.getAttribute('data-kc-filter');
      const group = await button.evaluate((el) => el.closest('[data-kc-filters]')?.getAttribute('data-kc-filters'));
      const label = (await button.innerText()).trim();
      await test.step(`${group}: ${label}`, async () => {
        await reset.click();
        await button.click();

        await expect(button).toHaveAttribute('aria-pressed', 'true');
        for (const sibling of await page.locator(`[data-kc-filters="${group}"] button[data-kc-filter]`).all()) {
          if ((await sibling.getAttribute('data-kc-filter')) !== key) {
            await expect(sibling).toHaveAttribute('aria-pressed', 'false');
          }
        }

        const panel = page.locator(`[data-kc-section-panel="${group}"]`);
        const visibleCards = panel.locator(VISIBLE_CARD);
        const visible = await visibleCards.count();
        const counter = releaseNumber(await panel.locator('[data-kc-section-count]').textContent());
        expect(counter, `"${group}" counter after choosing "${label}"`).toBe(visible);
        expect(visible, `"${label}" shows at least one release`).toBeGreaterThan(0);
        if (key === 'all') {
          expect(visible, `"${label}" shows the whole section`).toBe(await panel.locator(CARD).count());
        } else {
          const outside = await visibleCards.evaluateAll(
            (els, filter) =>
              els
                .filter((el) => !(el.getAttribute('data-kc-groups') ?? '').split(/\s+/).includes(filter))
                .map((el) => el.getAttribute('data-kc-release')),
            key,
          );
          expect(outside, `visible "${group}" releases outside "${key}"`).toEqual([]);
        }
        await expectCountsMatchVisibleCards(page, total);
      });
    }
  });

  test('one player at a time, and closing it returns focus to its trigger', async ({ openHome }) => {
    const page = await openHome();
    await catalogueReady(page);
    const frames = page.locator('iframe');
    await expect(frames, 'no player before a click').toHaveCount(0);

    const youtubeButton = page.locator('button[data-kc-media="youtube"]:not(.kc-track-play)').first();
    const youtube = await cardOf(page, youtubeButton);
    await youtubeButton.click();
    await expect(frames).toHaveCount(1);
    await expect(youtube.card.locator('[data-kc-embed] iframe')).toHaveCount(1);
    await expect(frames).toHaveAttribute('src', YOUTUBE_EMBED);
    await expect(youtube.card).toHaveClass(PLAYING);

    // The first Spotify trigger outside the playing card. Inside it, the player covers the
    // poster play button, so a user cannot click that one until the player is closed.
    const spotifyButton = page
      .locator(`${CARD}:not([data-kc-release="${youtube.id}"]) button[data-kc-media="spotify"]:not(.kc-track-play)`)
      .first();
    const spotify = await cardOf(page, spotifyButton);
    await spotifyButton.click();
    await expect(frames, 'starting a player stops the other one').toHaveCount(1);
    await expect(spotify.card.locator('[data-kc-embed] iframe')).toHaveCount(1);
    await expect(frames).toHaveAttribute('src', SPOTIFY_EMBED);
    await expect(spotify.card).toHaveClass(PLAYING);
    await expect(youtube.card).not.toHaveClass(PLAYING);

    await spotify.card.locator('[data-kc-stop]').click();
    await expect(frames).toHaveCount(0);
    await expect(spotifyButton, 'focus returns to the play button that opened the player').toBeFocused();
    await expect(spotify.card).not.toHaveClass(PLAYING);
  });

  test('the skip link is the first Tab stop and moves focus to the main content', async ({ openHome }) => {
    const page = await openHome();
    const skipLink = page.locator('a.skip-link');

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute('href', '#main-content');
    const box = await skipLink.boundingBox();
    expect(box?.width ?? 0, 'the focused skip link is shown, not clipped to 1px').toBeGreaterThan(1);
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main-content');
  });
});
