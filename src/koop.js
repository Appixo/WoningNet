// Nieuwbouw project channels: projects from nieuwbouw.nl (koop or huur), plus
// whatever DĀK lists under Koop, filtered by price and by an area drawn on the
// map.
//
// Alerts fire for a project the first time it shows up inside the filters, and
// again when a tracked project moves into sale or verhuur ("Aangekondigd" ->
// "In verkoop"). That second event is the one that matters: nieuwbouw is
// usually allocated by inschrijving/loting in the first days after it opens.
//
// Each run keeps its own store (data/seen-koop.json, data/seen-huur-projects.json),
// separate from the DĀK huur store, so any of them can be reset independently.

import { fetchProjects, fetchProjectDetail } from './nieuwbouw.js';
import { pointInPolygon } from './geo.js';
import { notifyProjects } from './notify.js';
import { readJson, writeJson } from './store.js';

const DETAIL_CONCURRENCY = 4;
const RETENTION_DAYS = 90;

// "In verkoop", "Voorverkoop", "Inschrijving open", "Beschikbaar", "In verhuur"
const OPEN_STATUS = /verkoop|verhuur|inschrijv|beschikbaar/i;
const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const includesAny = (haystack, needle) => haystack.some((h) => eq(h, needle));

const euro = (amount) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);

/** A DAK koop publication in the same shape as a nieuwbouw.nl project. */
export function fromDak(listing) {
  return {
    id: `dak-${listing.id}`,
    kind: 'koop',
    source: 'DĀK',
    url: listing.url,
    name: listing.address,
    municipality: '',
    place: listing.city,
    district: listing.district,
    types: listing.type || '',
    priceText: listing.price ? euro(listing.price) : '',
    minPrice: listing.price,
    maxPrice: listing.price,
    status: 'In verkoop',
    badges: [],
    availability: listing.closesAt ? `reageren tot ${listing.closesAt}` : '',
    photo: listing.photo,
    lat: listing.lat,
    lon: listing.lon,
    detail: null,
  };
}

// Koop projects are capped by maxPrice, huur projects by maxRent (per month).
const capFor = (kind, cfg) => (kind === 'huur' ? cfg.maxRent : cfg.maxPrice);

/** @returns {{ matched: boolean, reason?: string }} */
export function koopMatches(item, cfg) {
  const reject = (reason) => ({ matched: false, reason });
  const cap = capFor(item.kind ?? 'koop', cfg);

  if (cfg.excludeStatuses?.length && includesAny(cfg.excludeStatuses, item.status)) {
    return reject(`status ${item.status}`);
  }
  // Compare against the cheapest unit: a project is interesting if *anything*
  // in it is affordable. Unknown prices ("op aanvraag") are kept, never hidden.
  if (cap != null && item.minPrice != null && item.minPrice > cap) {
    return reject(`cheapest unit ${euro(item.minPrice)} above ${euro(cap)}`);
  }
  if (cfg.minPrice && item.maxPrice != null && item.maxPrice < cfg.minPrice) {
    return reject(`most expensive unit ${euro(item.maxPrice)} below minPrice`);
  }
  if (cfg.excludeTypes?.length && item.types) {
    const types = item.types.split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length && types.every((t) => includesAny(cfg.excludeTypes, t))) {
      return reject(`only excluded types (${item.types})`);
    }
  }
  if (cfg.places?.length && !includesAny(cfg.places, item.place)) {
    return reject(`place ${item.place} not in places`);
  }
  if (cfg.area?.length >= 3 && item.lat != null && item.lon != null) {
    if (!pointInPolygon([item.lat, item.lon], cfg.area)) {
      return reject(`outside area (${item.place})`);
    }
  }
  return { matched: true };
}

// Fetch detail pages a few at a time rather than all at once.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function describeEvent(event) {
  const { item } = event;
  const price = item.priceText || 'prijs op aanvraag';
  const where = [item.place, item.district].filter(Boolean).join(', ');
  const kind = event.kind === 'sale-start' ? `${event.from} -> ${item.status}` : `${event.kind}, ${item.status}`;
  return `  ${price.padEnd(28)} | ${item.name} | ${where} | ${item.availability || '-'} | ${kind}`;
}

/**
 * One poll of nieuwbouw.nl for the given kind ('koop' or 'huur'), plus any
 * extra items (DĀK koop) that should share the same filters and store.
 */
export async function runProjects({ kind, label, config: cfg, extraItems = [], storePath, webhookUrl, dryRun, seedOnly }) {
  const tag = `[${label}]`;
  const { data: store, existed } = await readJson(storePath, { checkedAt: null, projects: {} });
  const projects = store.projects ?? {};

  // nieuwbouw.nl changes a few times a week, not a few times an hour. Poll it
  // far less often than DAK; the workflow still runs every 10 minutes for huur.
  const intervalMinutes = cfg.intervalMinutes ?? 60;
  const sinceLast = store.checkedAt ? Date.now() - new Date(store.checkedAt).getTime() : Infinity;
  if (!dryRun && !seedOnly && sinceLast < intervalMinutes * 60 * 1000) {
    console.log(`${tag} Checked ${Math.round(sinceLast / 60000)} min ago; polling every ${intervalMinutes} min. Skipping.`);
    return;
  }

  const municipalities = cfg.municipalities ?? [];
  const nieuwbouw = municipalities.length ? await fetchProjects(municipalities, kind) : [];
  const items = [...nieuwbouw, ...extraItems];
  console.log(
    `${tag} ${nieuwbouw.length} nieuwbouw ${kind}projecten in ${municipalities.join(', ')}` +
      (extraItems.length ? `; ${extraItems.length} extra` : ''),
  );

  const now = new Date().toISOString();
  for (const item of items) {
    const prev = projects[item.id];
    if (prev?.detail) {
      item.detail = prev.detail;
      item.lat ??= prev.detail.lat;
      item.lon ??= prev.detail.lon;
    }
  }

  // Detail pages (coordinates, dates) are only fetched for projects that pass
  // the cheap filters, and only once; the result is cached in the store.
  const needDetail = items.filter(
    (item) =>
      item.source === 'nieuwbouw.nl' && !item.detail && koopMatches({ ...item, lat: null, lon: null }, cfg).matched,
  );
  await mapLimit(needDetail, DETAIL_CONCURRENCY, async (item) => {
    try {
      item.detail = await fetchProjectDetail(item.url);
      item.lat = item.detail.lat;
      item.lon = item.detail.lon;
      item.minPrice ??= item.detail.minPrice;
      item.maxPrice ??= item.detail.maxPrice;
    } catch (error) {
      // Missing geo never hides a project; it just cannot be area-filtered.
      console.warn(`${tag} Could not read detail page for ${item.name}: ${error.message}`);
    }
  });

  const matched = [];
  const skipped = [];
  const events = [];
  const nextProjects = {};
  for (const item of items) {
    const prev = projects[item.id];
    const verdict = koopMatches(item, cfg);
    (verdict.matched ? matched : skipped).push({ item, reason: verdict.reason });

    if (verdict.matched) {
      if (!prev) {
        events.push({ kind: 'new', item });
      } else if (!eq(prev.status, item.status) && OPEN_STATUS.test(item.status) && !OPEN_STATUS.test(prev.status)) {
        events.push({ kind: 'sale-start', from: prev.status, item });
      }
    }

    nextProjects[item.id] = {
      name: item.name,
      place: item.place,
      status: item.status,
      minPrice: item.minPrice,
      maxPrice: item.maxPrice,
      url: item.url,
      detail: item.detail ?? prev?.detail ?? null,
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
  }

  // Projects that dropped off the site stay remembered for a while, so a brief
  // delisting does not turn into a duplicate "new project" alert.
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, prev] of Object.entries(projects)) {
    if (!(id in nextProjects) && new Date(prev.lastSeenAt).getTime() > cutoff) nextProjects[id] = prev;
  }

  console.log(`${tag} ${matched.length} match your config`);

  if (dryRun) {
    console.log(`\n--- ${label} matches (${matched.length}) ---`);
    for (const { item } of matched) {
      const event = events.find((e) => e.item === item);
      console.log(describeEvent(event ?? { kind: 'known', item }) + (event ? '  <- would notify' : ''));
    }
    console.log(`\n--- ${label} skipped (${skipped.length}) ---`);
    for (const { item, reason } of skipped) console.log(`  ${item.name} (${item.place}) — ${reason}`);
    return;
  }

  const nextStore = { checkedAt: now, projects: nextProjects };

  if (seedOnly || !existed) {
    await writeJson(storePath, nextStore);
    console.log(
      `${tag} Seeded ${Object.keys(nextProjects).length} projects (${matched.length} matching) as already seen. No alerts sent.`,
    );
    return;
  }

  if (events.length) {
    await notifyProjects(webhookUrl, events, kind);
    console.log(`${tag} Sent ${events.length} alert${events.length === 1 ? '' : 's'}:`);
    for (const event of events) console.log(describeEvent(event));
  } else {
    console.log(`${tag} Nothing new.`);
  }

  await writeJson(storePath, nextStore);
}

/** The koop channel: nieuwbouw.nl koopprojecten plus DĀK koop. */
export function runKoop({ config, dakKoop, ...rest }) {
  return runProjects({ kind: 'koop', label: 'koop', config, extraItems: dakKoop.map(fromDak), ...rest });
}
