import { test, expect } from '@playwright/test';

const enestAlbum = 'https://enest.bandcamp.com/album/my-silent-past';

const releases = [
  {
    id: 'the-eighteen-forties',
    artist: 'The 1840s',
    title: 'The Eighteen-Forties',
    source: 'https://the1840s.bandcamp.com/album/the-eighteen-forties',
  },
  {
    id: 'sentences-by-my-love',
    artist: 'The Lonely Peters',
    title: 'Sentences By My Love',
    source: 'https://thelonelypeters.bandcamp.com/album/sentences-by-my-love',
  },
  {
    id: 'memorable-equinox',
    artist: 'Guy Goldstein',
    title: 'Memorable Equinox',
    source: 'https://guygoldstein.bandcamp.com/album/memorable-equinox',
  },
];

for (const release of releases) {
  test(`${release.title} is discoverable by artist and links to the credited album`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const filter = page.locator('[data-kc-artist-select]');
    await filter.locator('xpath=ancestor::details').evaluate((section) => { section.open = true; });
    await filter.selectOption({ label: release.artist });
    const result = page.locator('[data-kc-release]:visible');
    await expect(result).toHaveCount(1);
    await expect(result.getByRole('heading', { name: release.title })).toBeVisible();
    await expect(result.getByText('Listen to the album on Bandcamp')).toHaveAttribute('href', release.source);
    await result.getByRole('link', { name: 'Album credits', exact: true }).click();
    await expect(page.locator(`article#${release.id} a[href="${release.source}"]`)).toBeVisible();
  });
}

for (const route of ['music-production', 'music-for-film-tv-advertising']) {
  test(`${route} exposes its services and supporting credits without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    try {
      const page = await context.newPage();
      await page.goto(`/dogbeat/${route}/`, { waitUntil: 'domcontentloaded' });
      const entries = await page.locator('script[type="application/ld+json"]').allTextContents();
      const graph = entries.flatMap((entry) => { const data = JSON.parse(entry); return data['@graph'] || [data]; });
      const webPage = graph.find((node) => node['@type'] === 'WebPage');
      const services = graph.filter((node) => node['@type'] === 'Service');
      expect(webPage.mainEntity.map((item) => item['@id']).sort()).toEqual(services.map((item) => item['@id']).sort());
      const sources = route === 'music-production' ? [
        ...releases.map((release) => release.source),
        enestAlbum,
        'https://www.ynet.co.il/articles/0,7340,L-4726453,00.html',
        'https://noam-rotem.bandcamp.com/album/--2',
        'https://www.nli.org.il/he/items/NNL_MUSIC_AL990047639490205171/NLI',
        'https://hazeevot.bandcamp.com/album/the-flat-earth',
      ] : [
        'https://artlist.io/royalty-free-music/song/fast-as-you-can/110211',
        'https://www.tmu-na.org.il/?ArticleID=2441&CategoryID=166',
      ];
      expect(webPage.citation.slice().sort()).toEqual(sources.slice().sort());
      for (const url of sources) {
        await expect(page.locator(`main a[href="${url}"]`).first()).toBeVisible();
      }
      const hebrew = page.locator('main section[lang="he"][dir="rtl"]');
      await expect(hebrew.getByRole('heading')).toBeVisible();
      if (route === 'music-production') {
        const hero = page.locator('section.hero');
        await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Indie music production and mixing in Tel Aviv');
        await expect(hero).toContainText('live instruments and electronics');
        await expect(hero.getByRole('link', { name: 'Start with a demo' })).toHaveAttribute('href', '#project-brief');
        await expect(hero.getByRole('link', { name: 'Hear selected recordings' })).toHaveAttribute('href', '#selected-work');
        await expect(page.locator('#project-brief').getByRole('link', { name: 'Send a demo by email' }))
          .toHaveAttribute('href', /^mailto:/);
        await expect(page.locator('#project-brief').getByRole('link', { name: 'Discuss your project on WhatsApp' }))
          .toHaveAttribute('href', /^https:\/\/wa\.me\//);
        const enest = page.locator('#selected-work article#my-silent-past');
        await expect(enest.getByRole('heading', { name: 'ENEST — My Silent Past' })).toBeVisible();
        await expect(enest).toContainText('Avichai Tuchman co-produced the album with ENEST and mixed it.');
        await expect(enest.getByRole('link', { name: 'Listen and read the album credits on Bandcamp' }))
          .toHaveAttribute('href', enestAlbum);
        await expect(hebrew.getByRole('link', { name: 'My Silent Past' })).toHaveAttribute('href', '#my-silent-past');
      }
      for (const target of await hebrew.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.hash))) {
        await expect(page.locator(target)).toHaveCount(1);
      }
    } finally {
      await context.close();
    }
  });
}
