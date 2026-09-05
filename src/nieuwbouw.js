// Client for the public project listings on nieuwbouw.nl.
//
// The site is a Laravel/Livewire app, but its list pages are fully
// server-rendered: every project card is in the HTML (18 per page) and carries
// a stable ULID in data-project-id. No API, no login, no JavaScript needed.
//
// Detail pages carry schema.org JSON-LD with the project's coordinates and
// price range, plus a "Datums" block with sale, build and delivery dates. They
// are only fetched once per project; the result is cached in the seen-store.

const ORIGIN = 'https://nieuwbouw.nl';
const PAGE_SIZE = 18;
const MAX_PAGES = 10;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function getHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'nl-NL,nl;q=0.9' },
  });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.text();
}

// Blade leaves conditional-comment markers all over the markup; strip them so
// the regexes below only have to deal with real tags.
const stripBlocks = (html) => html.replace(/<!--\[if (?:END)?BLOCK\]><!\[endif\]-->/g, '');

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ')
    .trim();

const first = (re, s) => {
  const m = re.exec(s);
  return m ? decode(m[1]) : '';
};

// "€ 308.030 - € 650.000 v.o.n." -> [308030, 650000]
const euros = (s) => [...s.matchAll(/€\s*([\d.]+)/g)].map((m) => Number(m[1].replace(/\./g, '')));

const KNOWN_STATUS = /^(in verkoop|aangekondigd|verkocht|uitverkocht|bouw gestart|opgeleverd|voorverkoop|inschrijving[^<]*|binnenkort in verkoop|start verkoop[^<]*)$/i;

export function parseListPage(html, municipality) {
  const chunks = stripBlocks(html).split(/data-gtm-track="project-card"/).slice(1);

  return chunks
    .map((chunk) => {
      const id = first(/data-project-id="([^"]+)"/, chunk);
      if (!id) return null;

      const url = first(/href="(https:\/\/nieuwbouw\.nl\/aanbod\/[^"]+)"\s+dusk="project-card-link"/, chunk);
      const name = first(/dusk="project-card-link">\s*(?:<span[^>]*><\/span>)?\s*([^<]+?)\s*<\/a>/, chunk);
      const location = first(/<h4[^>]*>\s*([^<]+?)\s*<\/h4>/, chunk);
      const [place = '', ...rest] = location.split(',').map((s) => s.trim());
      const types = first(/<span class="[^"]*\btruncate">\s*([^<]+?)\s*<\/span>/, chunk);
      const priceText = first(/whitespace-nowrap">\s*([^<]+?)\s*</, chunk);
      const prices = euros(priceText);

      const badges = [...chunk.matchAll(/rounded-full[^>]*>\s*([^<]+?)\s*<\/span>/g)]
        .map((m) => decode(m[1]))
        .filter((b) => KNOWN_STATUS.test(b));

      // "2 van 18 beschikbaar" while selling, "268 verwacht" before the start.
      const avail = /(\d+)\s+van\s+(\d+)\s+beschikbaar|(\d+)\s+verwacht/.exec(chunk);
      const photo = first(/src="(https:\/\/media\.nieuwbouw\.nl\/[^"]+)"/, chunk);

      return {
        id,
        source: 'nieuwbouw.nl',
        url: url || `${ORIGIN}/aanbod/koop/${municipality}/${id}`,
        name,
        municipality,
        place,
        district: rest.join(', '),
        types,
        priceText,
        minPrice: prices[0] ?? null,
        maxPrice: prices[1] ?? prices[0] ?? null,
        // Announced projects carry no badge at all, only "N verwacht".
        status: badges[0] || (/verwacht/.test(avail?.[0] ?? '') ? 'Aangekondigd' : 'onbekend'),
        badges,
        availability: avail ? decode(avail[0]) : '',
        available: avail ? Number(avail[1] ?? avail[3]) : null,
        totalUnits: avail ? Number(avail[2] ?? avail[3]) : null,
        photo: photo || null,
      };
    })
    .filter(Boolean);
}

export function parseDetailPage(html) {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => {
      try { return JSON.parse(m[1]); } catch { return null; }
    })
    .filter(Boolean);
  const graph = ld.flatMap((j) => j['@graph'] ?? [j]);
  const listing = graph.find((g) => g['@type'] === 'RealEstateListing') ?? {};
  const geo = listing.contentLocation?.geo ?? {};
  const spec = listing.offers?.priceSpecification ?? {};

  // The "Datums" and "Overig" blocks are plain label/value pairs; flatten the
  // page to " | label | value | " and read them back out.
  const text = stripBlocks(html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ');
  const labelled = (label) => {
    const m = new RegExp(String.raw`\|\s*${label}\s*\|\s*([^|]+?)\s*\|`).exec(text);
    return m ? decode(m[1]) : '';
  };

  return {
    lat: Number(geo.latitude) || null,
    lon: Number(geo.longitude) || null,
    minPrice: Number(spec.minPrice) || null,
    maxPrice: Number(spec.maxPrice) || null,
    developer: labelled('Project van'),
    dates: {
      voorverkoop: labelled('Voorverkoop'),
      startVerkoop: labelled('Start verkoop'),
      startBouw: labelled('Start bouw'),
      oplevering: labelled('Oplevering'),
    },
  };
}

/** All koop projects listed for the given gemeente slugs, de-duplicated by id. */
export async function fetchProjects(municipalities) {
  const seen = new Map();

  for (const slug of municipalities) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = `${ORIGIN}/aanbod/koop/${slug}${page > 1 ? `?page=${page}` : ''}`;
      const cards = parseListPage(await getHtml(url), slug);
      // A project can be rendered twice on one page (a highlighted card plus
      // the grid card); keep whichever variant carries the status badge.
      for (const card of cards) {
        const prev = seen.get(card.id);
        if (!prev || (!prev.badges.length && card.badges.length)) seen.set(card.id, card);
      }
      if (cards.length < PAGE_SIZE) break;
    }
  }

  return [...seen.values()];
}

export async function fetchProjectDetail(url) {
  return parseDetailPage(await getHtml(url));
}
