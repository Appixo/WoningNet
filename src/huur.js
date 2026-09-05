// The huur channel: DĀK regio Utrecht aanbod, filtered by config.json, alerts
// for homes that were not in data/seen.json yet.

import { matches } from './filter.js';
import { notifyHuur } from './notify.js';
import { readJson, writeJson } from './store.js';

// Keep ids only while their listing could still be live. Without this the store
// grows forever and a re-published id would be wrongly treated as already seen.
function prune(entries) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return Object.fromEntries(
    Object.entries(entries).filter(([, closesAt]) => {
      const time = new Date(closesAt).getTime();
      return !Number.isFinite(time) || time > cutoff;
    }),
  );
}

export async function runHuur({ config, region, listings, storePath, webhookUrl, dryRun, seedOnly }) {
  const matched = [];
  const skipped = [];
  for (const listing of listings) {
    const verdict = matches(listing, config);
    (verdict.matched ? matched : skipped).push({ listing, reason: verdict.reason });
  }

  console.log(`[huur] ${region}: ${listings.length} listings online, ${matched.length} match your config`);

  const { data, existed } = await readJson(storePath, { entries: {} });
  const entries = data.entries ?? {};
  const fresh = matched.filter(({ listing }) => !(listing.id in entries)).map((m) => m.listing);

  if (dryRun) {
    console.log(`\n--- huur matches (${matched.length}) ---`);
    for (const { listing } of matched) {
      const tags = [
        listing.isLoting ? 'LOTING' : null,
        listing.isVrijeSector ? 'VRIJE SECTOR' : null,
        listing.isNieuwbouw ? 'NIEUWBOUW' : null,
        listing.label || null,
      ].filter(Boolean).join(',');
      const isNew = listing.id in entries ? '' : '  <- would notify';
      console.log(
        `  EUR${String(listing.rent).padStart(7)} | ${String(listing.rooms)}k | ` +
          `${String(listing.area).padStart(6)}m2 | ${listing.city}, ${listing.address}` +
          `${tags ? ` [${tags}]` : ''}${isNew}`,
      );
    }
    console.log(`\n--- huur skipped (${skipped.length}) ---`);
    for (const { listing, reason } of skipped) {
      console.log(`  ${listing.city}, ${listing.address} — ${reason}`);
    }
    return;
  }

  const nextEntries = prune({ ...entries });
  for (const { listing } of matched) nextEntries[listing.id] = listing.closesAt;

  // A first run would otherwise fire every currently-open listing at once. Seed
  // silently instead, so the first real alert is a genuinely new home.
  if (seedOnly || !existed) {
    await writeJson(storePath, { entries: nextEntries });
    console.log(`[huur] Seeded ${Object.keys(nextEntries).length} listings as already seen. No alerts sent.`);
    return;
  }

  if (fresh.length) {
    await notifyHuur(webhookUrl, fresh);
    console.log(`[huur] Sent ${fresh.length} alert${fresh.length === 1 ? '' : 's'}:`);
    for (const listing of fresh) console.log(`  ${listing.city}, ${listing.address} — ${listing.url}`);
  } else {
    console.log('[huur] No new listings.');
  }

  await writeJson(storePath, { entries: nextEntries });
}
