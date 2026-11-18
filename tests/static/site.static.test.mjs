/**
 * Static QA checks for the Kesem Records site.
 *
 * Reads the deployable files in public/ directly: no build, no server, no browser and nothing
 * beyond Node's built-ins. Each test collects every problem it finds and then fails once with the
 * full list, so a single run names every offending page, link or file.
 *
 * Run: node --test "tests/static/*.test.mjs"   (npm run test:static)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_ORIGIN = 'https://kesem-records.netlify.app';

/** JSON-LD nodes that every page repeats; they must be identical everywhere. */
const SHARED_NODES = {
  Person: `${SITE_ORIGIN}/dogbeat/#avi-tuchman`,
  Organization: `${SITE_ORIGIN}/#organization`,
  WebSite: `${SITE_ORIGIN}/#website`,
};
const VIDEO_SITEMAP_FIELDS = ['thumbnail_loc', 'title', 'description', 'player_loc'];
const VIDEO_OBJECT_FIELDS = ['name', 'thumbnailUrl', 'uploadDate', 'embedUrl'];
const YOUTUBE_EMBED_URL = /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}$/;
const ROBOTS_META_NAMES = new Set(['robots', 'googlebot', 'bingbot']);
const SECURITY_HEADERS = ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy'];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Runs `load` on first use and caches the result, so all tests share one parse of the site. */
function once(load) {
  let cache;
  return () => (cache ??= { value: load() }).value;
}

/** Fails with one line per problem, so the failure lists every offending page or path. */
function assertNoProblems(label, problems) {
  if (problems.length > 0) {
    assert.fail(`${label}: ${problems.length} problem(s)\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------
// Files and site URLs
// ---------------------------------------------------------------------------------------------

function statOf(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

const isFile = (file) => statOf(file)?.isFile() ?? false;
const readText = (file) => fs.readFileSync(file, 'utf8');
const readIfExists = (file) => (isFile(file) ? readText(file) : null);

/** Repository-relative path with forward slashes, for messages. */
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/** Every .html file under a directory, sorted. */
function htmlFilesIn(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith('.html'))
    .map((name) => path.join(dir, name))
    .filter(isFile)
    .sort();
}

/**
 * File in public/ for a URL path on the site: "/about/" -> public/about/index.html,
 * "/og/x.png" -> public/og/x.png. Returns null when the path would leave public/.
 */
function publicFileFor(sitePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(sitePath);
  } catch {
    return null;
  }
  const file = path.join(PUBLIC_DIR, decoded.endsWith('/') ? `${decoded}index.html` : decoded);
  return file.startsWith(PUBLIC_DIR + path.sep) ? file : null;
}

/** Why a URL path on the site does not resolve to a file in public/, or null when it does. */
function unresolvedReason(sitePath) {
  const file = publicFileFor(sitePath);
  if (!file) return 'points outside public/';
  if (isFile(file)) return null;
  if (statOf(file)?.isDirectory()) return `${relative(file)} is a directory (link to "${sitePath}/")`;
  return `${relative(file)} does not exist`;
}

/**
 * URL path ("/about/") of a root-relative or same-origin absolute URL, without ?query and
 * #fragment. Returns null for other sites, protocol-relative, relative, mailto: and similar links.
 */
function sitePathOf(href) {
  const value = href.trim();
  const rootRelative = value.startsWith('/') && !value.startsWith('//');
  if (!rootRelative && !value.startsWith(SITE_ORIGIN)) return null;
  try {
    const url = new URL(value, SITE_ORIGIN);
    return url.origin === SITE_ORIGIN ? url.pathname : null;
  } catch {
    return null;
  }
}

/** public/<path>index.html for a page URL such as https://kesem-records.netlify.app/about/, or null. */
function pageFileFor(pageUrl) {
  if (!pageUrl.startsWith(`${SITE_ORIGIN}/`) || !pageUrl.endsWith('/')) return null;
  return publicFileFor(pageUrl.slice(SITE_ORIGIN.length));
}

/** Absolute http(s) URLs in plain text or Markdown, without trailing sentence punctuation. */
function urlsIn(text) {
  return [...text.matchAll(/https?:\/\/[^\s<>"'`()[\]]+/g)].map(([url]) => url.replace(/[.,;:!?]+$/, ''));
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the character references used in attribute values and XML text. */
function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, decimal, name) => {
    if (name) return NAMED_ENTITIES[name] ?? match;
    const code = hex ? parseInt(hex, 16) : Number(decimal);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Elements whose content is raw text, not markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
/** A comment, a doctype or similar, an end tag, or a start tag (quoted values may contain ">"). */
const HTML_TOKEN = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<\/[^>]*>|<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const HTML_ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attributes of a start tag, with lower-cased names and decoded values ('' for bare attributes). */
function parseAttributes(source) {
  const attrs = Object.create(null);
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of source.matchAll(HTML_ATTRIBUTE)) {
    const key = name.toLowerCase();
    if (!(key in attrs)) attrs[key] = decodeEntities(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
  }
  return attrs;
}

/**
 * Minimal HTML tokenizer: every start tag in document order as { name, attrs, text }.
 * Comments and end tags are skipped; script, style, textarea and title keep their raw content
 * in `text`, so markup inside them (or inside comments) is never mistaken for real elements.
 */
function parseHtml(html) {
  const elements = [];
  const tokens = new RegExp(HTML_TOKEN);
  let match;
  while ((match = tokens.exec(html)) !== null) {
    if (!match[1]) continue;
    const element = { name: match[1].toLowerCase(), attrs: parseAttributes(match[2]), text: '' };
    if (RAW_TEXT_ELEMENTS.has(element.name)) {
      const end = new RegExp(`</${element.name}(?:[\\s/][^>]*)?>`, 'gi');
      end.lastIndex = tokens.lastIndex;
      const close = end.exec(html);
      element.text = html.slice(tokens.lastIndex, close ? close.index : html.length);
      tokens.lastIndex = close ? end.lastIndex : html.length;
    }
    elements.push(element);
  }
  return elements;
}

/** content of the first <meta> whose name or property is `key`, trimmed. */
function metaContent(elements, key) {
  const meta = elements.find((el) => el.name === 'meta' && (el.attrs.property === key || el.attrs.name === key));
  return meta?.attrs.content?.trim();
}

const hasToken = (value, token) => (value ?? '').toLowerCase().split(/\s+/).includes(token);
const iframeSources = (elements) => elements.filter((el) => el.name === 'iframe').map((el) => (el.attrs.src ?? '').trim());

// ---------------------------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------------------------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isJsonLdScript = (el) => el.name === 'script' && (el.attrs.type ?? '').trim().toLowerCase() === 'application/ld+json';

/** Every ld+json block of a page, in order, as { data } or { error }. */
function jsonLdBlocks(elements) {
  return elements.filter(isJsonLdScript).map((script) => {
    try {
      return { data: JSON.parse(script.text) };
    } catch (error) {
      return { error };
    }
  });
}

/** Top-level nodes of a page: each block's root object(s) and the entries of their @graph. */
function topLevelNodes(page) {
  const nodes = [];
  for (const { data } of page.jsonLd) {
    for (const root of [data].flat().filter(isObject)) {
      nodes.push(root, ...[root['@graph'] ?? []].flat().filter(isObject));
    }
  }
  return nodes;
}

/** Every object in a JSON-LD value, at any depth, whose @type is (or includes) `type`. */
function nodesOfType(value, type, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) nodesOfType(item, type, found);
  } else if (isObject(value)) {
    if ([value['@type']].flat().includes(type)) found.push(value);
    for (const child of Object.values(value)) nodesOfType(child, type, found);
  }
  return found;
}

/** True for a non-empty string, a non-empty array of such values, or any other non-null value. */
function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === 'string') return value.trim() !== '';
  return value !== null && value !== undefined;
}

/** Top-level keys whose values differ between two JSON-serialised nodes, for failure messages. */
function differingKeys(a, b) {
  const [left, right] = [JSON.parse(a), JSON.parse(b)];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  );
  return keys.length > 0 ? `keys: ${keys.join(', ')}` : 'key order only';
}

/** Why a VideoObject contentUrl points at a web page instead of a media file, or null. */
function webPageReason(contentUrl) {
  if (typeof contentUrl !== 'string') return 'is not a URL string';
  const url = contentUrl.trim();
  if (!url) return 'is empty';
  if (/youtube\.com\/watch/i.test(url)) return 'is a YouTube watch page';
  if (/youtu\.be/i.test(url)) return 'is a youtu.be link';
  let pathname = url;
  try {
    pathname = new URL(url, SITE_ORIGIN).pathname;
  } catch {
    // Not parseable: judge the raw string only.
  }
  if (url.endsWith('/') || pathname.endsWith('/')) return 'ends with "/" (a web page)';
  if (/\.html?$/i.test(url) || /\.html?$/i.test(pathname)) return 'is an HTML page';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sitemap and pages
// ---------------------------------------------------------------------------------------------

/** Inner XML of every <tag>…</tag> element. */
function xmlElements(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'g'))].map((match) => match[1]);
}

/** Trimmed text of the first <tag> element (CDATA and entities resolved), or '' when absent. */
function xmlText(xml, tag) {
  const inner = xmlElements(xml, tag)[0]?.trim() ?? '';
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdata ? cdata[1] : decodeEntities(inner)).trim();
}

/** The <url> entries of public/sitemap.xml as { loc, videos: [{ thumbnail_loc, title, description, player_loc }] }. */
const sitemapEntries = once(() => {
  const xml = readText(path.join(PUBLIC_DIR, 'sitemap.xml')).replace(/<!--[\s\S]*?-->/g, '');
  const entries = xmlElements(xml, 'url').map((url) => ({
    loc: xmlText(url, 'loc'),
    videos: xmlElements(url, 'video:video').map((video) =>
      Object.fromEntries(VIDEO_SITEMAP_FIELDS.map((field) => [field, xmlText(video, `video:${field}`)])),
    ),
  }));
  assert.ok(entries.length > 0, 'public/sitemap.xml has no <url> entries');
  return entries;
});

/**
 * One entry per sitemap URL whose public/<path>index.html exists (the sitemap test reports the
 * others): { url, path, file, elements, jsonLd }.
 */
const sitemapPages = once(() =>
  [...new Set(sitemapEntries().map(({ loc }) => loc))].flatMap((url) => {
    const file = pageFileFor(url);
    if (!file || !isFile(file)) return [];
    const elements = parseHtml(readText(file));
    return [{ url, path: url.slice(SITE_ORIGIN.length), file, elements, jsonLd: jsonLdBlocks(elements) }];
  }),
);

/** Problems with the og:image of a page: absolute URL on the site, existing PNG, declared size. */
function ogImageProblems(elements) {
  const image = metaContent(elements, 'og:image');
  if (!image) return ['no og:image meta tag'];
  if (!image.startsWith(`${SITE_ORIGIN}/`)) return [`og:image ${image} is not an absolute URL on ${SITE_ORIGIN}`];
  const sitePath = sitePathOf(image);
  const reason = sitePath === null ? 'is not a valid URL on the site' : unresolvedReason(sitePath);
  if (reason) return [`og:image ${image}: ${reason}`];
  const file = publicFileFor(sitePath);
  const size = pngSize(file);
  if (!size) return [`og:image ${image}: ${relative(file)} is not a PNG file`];
  return ['width', 'height'].flatMap((side) => {
    const declared = metaContent(elements, `og:image:${side}`);
    if (declared === undefined) return [`no og:image:${side} meta tag (the PNG ${side} is ${size[side]})`];
    return Number(declared) === size[side] ? [] : [`og:image:${side} is ${declared}, but ${relative(file)} has ${side} ${size[side]}`];
  });
}

/** Width and height from a PNG's IHDR chunk (big-endian uint32 at bytes 16 and 20), or null if not a PNG. */
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const isPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString('latin1', 12, 16) === 'IHDR';
  return isPng ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test('sitemap: every <loc> is a unique page in public/, and every video entry is complete and embedded on its page', () => {
  const problems = [];
  const seen = new Set();
  const pages = new Map(sitemapPages().map((page) => [page.url, page]));
  for (const { loc, videos } of sitemapEntries()) {
    if (!loc) {
      problems.push('a <url> entry has no <loc>');
      continue;
    }
    if (seen.has(loc)) problems.push(`${loc}: listed more than once`);
    seen.add(loc);
    if (loc !== SITE_ORIGIN && !loc.startsWith(`${SITE_ORIGIN}/`)) {
      problems.push(`${loc}: does not start with ${SITE_ORIGIN}/`);
      continue;
    }
    const file = pageFileFor(loc);
    if (!loc.endsWith('/')) problems.push(`${loc}: does not end with "/", so it cannot map to public/<path>index.html`);
    else if (!file) problems.push(`${loc}: maps outside public/`);
    else if (!isFile(file)) problems.push(`${loc}: ${relative(file)} does not exist`);
    const page = pages.get(loc);
    if (!page) continue;

    const sources = iframeSources(page.elements);
    videos.forEach((video, index) => {
      const where = `${loc} <video:video> #${index + 1}`;
      for (const field of VIDEO_SITEMAP_FIELDS) {
        if (!video[field]) problems.push(`${where}: missing or empty <video:${field}>`);
      }
      if (!video.player_loc) return;
      if (!YOUTUBE_EMBED_URL.test(video.player_loc)) {
        problems.push(`${where}: player_loc ${video.player_loc} is not https://www.youtube.com/embed/<11-character id>`);
      }
      if (!sources.includes(video.player_loc)) {
        problems.push(`${where}: the page has no <iframe src="${video.player_loc}"> (iframe srcs: ${sources.join(', ') || 'none'})`);
      }
    });
  }
  assertNoProblems('public/sitemap.xml', problems);
});

test('canonical: every sitemap page has exactly one rel=canonical link, equal to its sitemap URL', () => {
  const problems = [];
  for (const page of sitemapPages()) {
    const hrefs = page.elements
      .filter((el) => el.name === 'link' && hasToken(el.attrs.rel, 'canonical'))
      .map((el) => (el.attrs.href ?? '').trim());
    if (hrefs.length !== 1) problems.push(`${page.path}: ${hrefs.length} canonical links (${hrefs.join(', ') || 'none'})`);
    else if (hrefs[0] !== page.url) problems.push(`${page.path}: canonical is ${hrefs[0] || '(empty)'}, sitemap URL is ${page.url}`);
  }
  assertNoProblems('canonical links', problems);
});

test('robots meta: no sitemap page is noindex', () => {
  const problems = [];
  for (const page of sitemapPages()) {
    for (const meta of page.elements) {
      if (meta.name !== 'meta' || !ROBOTS_META_NAMES.has((meta.attrs.name ?? '').trim().toLowerCase())) continue;
      const directives = (meta.attrs.content ?? '').toLowerCase().split(/[\s,;]+/);
      if (directives.includes('noindex') || directives.includes('none')) {
        problems.push(`${page.path}: <meta name="${meta.attrs.name}" content="${meta.attrs.content}">`);
      }
    }
  }
  assertNoProblems('noindex on sitemap pages', problems);
});

test('JSON-LD: every application/ld+json block on every sitemap page is valid JSON', () => {
  const problems = [];
  for (const page of sitemapPages()) {
    page.jsonLd.forEach(({ error }, index) => {
      if (error) problems.push(`${page.path}: ld+json block #${index + 1}: ${error.message}`);
    });
  }
  assertNoProblems('invalid JSON-LD', problems);
});

test('JSON-LD: the shared Person, Organization and WebSite nodes are on every sitemap page and identical', () => {
  const problems = [];
  for (const [type, id] of Object.entries(SHARED_NODES)) {
    const pagesByVersion = new Map();
    for (const page of sitemapPages()) {
      const versions = new Set(
        topLevelNodes(page)
          .filter((node) => node['@id'] === id)
          .map((node) => JSON.stringify(node)),
      );
      if (versions.size === 0) problems.push(`${type} ${id}: missing on ${page.path}`);
      if (versions.size > 1) problems.push(`${type} ${id}: ${versions.size} different versions on ${page.path}`);
      for (const version of versions) pagesByVersion.set(version, [...(pagesByVersion.get(version) ?? []), page.path]);
    }
    // The version used by most pages is the reference; every other version is reported with its pages.
    const [reference, ...others] = [...pagesByVersion].sort((a, b) => b[1].length - a[1].length);
    for (const [version, paths] of others) {
      problems.push(
        `${type} ${id}: differs (${differingKeys(reference[0], version)}) from the version on ${reference[1].length} page(s), on ${paths.join(', ')}`,
      );
    }
  }
  assertNoProblems('shared JSON-LD nodes', problems);
});

test('JSON-LD: every VideoObject has name, thumbnailUrl, uploadDate and embedUrl, and no web-page contentUrl', () => {
  const problems = [];
  for (const page of sitemapPages()) {
    const videos = page.jsonLd.flatMap(({ data }) => nodesOfType(data, 'VideoObject'));
    videos.forEach((video, index) => {
      const where = `${page.path} VideoObject #${index + 1}${typeof video.name === 'string' ? ` (${video.name})` : ''}`;
      for (const field of VIDEO_OBJECT_FIELDS) {
        if (!hasValue(video[field])) problems.push(`${where}: missing or empty ${field}`);
      }
      for (const contentUrl of [video.contentUrl ?? []].flat()) {
        const reason = webPageReason(contentUrl);
        if (reason) problems.push(`${where}: contentUrl ${JSON.stringify(contentUrl)} ${reason}`);
      }
    });
  }
  assertNoProblems('VideoObject', problems);
});

test('iframes: every <iframe> in public/**/*.html has a non-empty title', () => {
  const problems = [];
  for (const file of htmlFilesIn(PUBLIC_DIR)) {
    for (const iframe of parseHtml(readText(file)).filter((el) => el.name === 'iframe')) {
      if ((iframe.attrs.title ?? '').trim()) continue;
      const missing = iframe.attrs.title === undefined ? 'no' : 'an empty';
      problems.push(`${relative(file)}: <iframe src="${iframe.attrs.src ?? ''}"> has ${missing} title`);
    }
  }
  assertNoProblems('iframes without a title', problems);
});

test('internal links: every root-relative or same-origin href on sitemap pages resolves to a file in public/', () => {
  const problems = new Set();
  for (const page of sitemapPages()) {
    for (const element of page.elements) {
      if (element.attrs.href === undefined) continue;
      const sitePath = sitePathOf(element.attrs.href);
      const reason = sitePath === null ? null : unresolvedReason(sitePath);
      if (reason) problems.add(`${page.path}: <${element.name} href="${element.attrs.href}"> -> ${reason}`);
    }
  }
  assertNoProblems('broken internal links', [...problems]);
});

test('social image: home og:image is a site PNG whose size matches og:image:width/height, and twitter:card is summary_large_image', () => {
  const elements = parseHtml(readText(path.join(PUBLIC_DIR, 'index.html')));
  const problems = ogImageProblems(elements);
  const card = metaContent(elements, 'twitter:card');
  if (card !== 'summary_large_image') {
    problems.push(`twitter:card is ${card === undefined ? 'missing' : `"${card}"`}, expected "summary_large_image"`);
  }
  assertNoProblems('public/index.html social image', problems);
});

test('robots.txt declares the sitemap; llms.txt exists, is not empty, and every site URL in it resolves', () => {
  const problems = [];
  const sitemapUrl = `${SITE_ORIGIN}/sitemap.xml`;
  const robots = readIfExists(path.join(PUBLIC_DIR, 'robots.txt'));
  if (robots === null) problems.push('public/robots.txt does not exist');
  else if (!new RegExp(`^[ \\t]*Sitemap:[ \\t]*${escapeRegExp(sitemapUrl)}[ \\t\\r]*$`, 'im').test(robots)) {
    problems.push(`public/robots.txt has no "Sitemap: ${sitemapUrl}" line`);
  }

  const llms = readIfExists(path.join(PUBLIC_DIR, 'llms.txt'));
  if (llms === null) problems.push('public/llms.txt does not exist');
  else if (!llms.trim()) problems.push('public/llms.txt is empty');
  else {
    for (const url of new Set(urlsIn(llms))) {
      const sitePath = sitePathOf(url);
      const reason = sitePath === null ? null : unresolvedReason(sitePath);
      if (reason) problems.push(`public/llms.txt: ${url} -> ${reason}`);
    }
  }
  assertNoProblems('robots.txt / llms.txt', problems);
});

test('security headers: public/_headers sets X-Content-Type-Options, Referrer-Policy, X-Frame-Options and Permissions-Policy', () => {
  const headers = readIfExists(path.join(PUBLIC_DIR, '_headers'));
  if (headers === null) assert.fail('public/_headers does not exist');
  // Netlify header lines are indented under a path line: "  Name: value".
  const missing = SECURITY_HEADERS.filter(
    (name) => !new RegExp(`^[ \\t]+${escapeRegExp(name)}[ \\t]*:[ \\t]*\\S`, 'im').test(headers),
  );
  assertNoProblems(
    'public/_headers',
    missing.map((name) => `no indented "${name}: <value>" line`),
  );
});
