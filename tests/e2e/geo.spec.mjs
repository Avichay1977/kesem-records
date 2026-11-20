import { test, expect } from '@playwright/test';

const enestAlbum = 'https://enest.bandcamp.com/album/my-silent-past';
const selectedIndieExamples = [
  ['maale-ashan', 'https://roeifreilich.bandcamp.com/album/--2', 'produced and mixed the single'],
  ['nishmor-al-hahaverim', 'https://reinesgirls.bandcamp.com/album/-', 'mixed it with Eliyada Ramon'],
  ['harigush-shebanefila', 'https://roeifreilich.bandcamp.com/album/--3', 'contributed bass and backing vocals'],
];
const leadRecordings = [
  ['nishmor-al-hahaverim', 'https://www.youtube.com/watch?v=b9xKq-5tE1Q'],
  ['maale-ashan', 'https://www.youtube.com/watch?v=wS_ahiD_qKc'],
  ['jane-and-the-boy-remix', 'https://www.youtube.com/watch?v=8D5vmPjjY14'],
  ['jane-and-the-boy-remix', 'https://artlist.io/royalty-free-music/song/i-dont-want-it-dogbeat-remix/97187'],
];
const faranAndRemixSources = [
  'https://music.apple.com/us/album/%D7%9E%D7%A7%D7%A8%D7%94-%D7%90%D7%91%D7%95%D7%93-ep/1884640507',
  'https://www.youtube.com/watch?v=rqFYO72tGAM',
  'https://www.nli.org.il/he/items/NNL_MUSIC_AL997013340264405171/NLI',
  'https://www.youtube.com/watch?v=fW5FZm3X4MM',
  'https://www.qobuz.com/ie-en/album/long-time-coming-avichai-tuchman-aka-dogbeat-remix-balkan-beat-box/maebcpfi1v83b',
  'https://artlist.io/royalty-free-music/song/i-dont-want-it-dogbeat-remix-instrumental-version/97188',
];

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
        ...selectedIndieExamples.map(([, url]) => url),
        ...leadRecordings.map(([, url]) => url),
        ...faranAndRemixSources,
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
        for (const [id, url, credit] of selectedIndieExamples) {
          const example = page.locator(`#selected-work article#${id}`);
          await expect(example).toContainText(credit);
          await expect(example.locator(`a[href="${url}"]`)).toBeVisible();
        }
        await expect(page.locator('#selected-work article').nth(0)).toHaveAttribute('id', 'nishmor-al-hahaverim');
        await expect(page.locator('#selected-work article').nth(1)).toHaveAttribute('id', 'maale-ashan');
        await expect(page.locator('#remixes article').first()).toHaveAttribute('id', 'jane-and-the-boy-remix');
        for (const [id, url] of leadRecordings) {
          await expect(page.locator(`article#${id} a[href="${url}"]`)).toBeVisible();
        }
        await expect(page.locator('#featured-ep #mikre-avud-title-track')).toContainText('played on, produced and mixed');
        await expect(page.locator('#featured-ep #sheker-katan')).toContainText('arranged, produced and mixed it');
        await expect(page.locator('#remixes article')).toHaveCount(2);
      }
      for (const target of await hebrew.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.hash))) {
        await expect(page.locator(target)).toHaveCount(1);
      }
    } finally {
      await context.close();
    }
  });
}
