// Entry point. One run = one poll of the portal.
//
//   node src/index.js            check, notify, update the seen-store
//   node src/index.js --dry-run  show what would happen, send nothing, save nothing
//   node src/index.js --seed     mark everything currently listed as already seen
//
// State lives in data/seen.json, committed back by the GitHub Action. That is
// the whole persistence layer: no database, no server, nothing to pay for.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAanbod } from './dak.js';
import { normalize } from './listing.js';
import { matches } from './filter.js';
import { notify } from './notify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEN_PATH = join(ROOT, 'data', 'seen.json');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const seedOnly = args.has('--seed');

async function readSeen() {
  try {
    const parsed = JSON.parse(await readFile(SEEN_PATH, 'utf8'));
    return { entries: parsed.entries ?? {}, isFirstRun: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { entries: {}, isFirstRun: true };
  }
}

async function writeSeen(entries) {
  await mkdir(dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, `${JSON.stringify({ entries }, null, 2)}\n`);
}

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

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl && !dryRun && !seedOnly) {
    throw new Error('DISCORD_WEBHOOK_URL is not set — add it as a repository secret');
  }

  const { region, listings: raw } = await fetchAanbod();
  const all = raw.map(normalize);

  const matched = [];
  const skipped = [];
  for (const listing of all) {
    const verdict = matches(listing, config);
    (verdict.matched ? matched : skipped).push({ listing, reason: verdict.reason });
  }

  console.log(`${region}: ${all.length} listings online, ${matched.length} match your config`);

  const { entries, isFirstRun } = await readSeen();
  const fresh = matched.filter(({ listing }) => !(listing.id in entries)).map((m) => m.listing);

  if (dryRun) {
    console.log(`\n--- matches (${matched.length}) ---`);
    for (const { listing } of matched) {
      const tags = [
        listing.isLoting ? 'LOTING' : null,
        listing.isVrijeSector ? 'VRIJE SECTOR' : null,
        listing.label || null,
      ].filter(Boolean).join(',');
      const isNew = listing.id in entries ? '' : '  <- would notify';
      console.log(
        `  EUR${String(listing.rent).padStart(7)} | ${String(listing.rooms)}k | ` +
          `${String(listing.area).padStart(6)}m2 | ${listing.city}, ${listing.address}` +
          `${tags ? ` [${tags}]` : ''}${isNew}`,
      );
    }
    console.log(`\n--- skipped (${skipped.length}) ---`);
    for (const { listing, reason } of skipped) {
      console.log(`  ${listing.city}, ${listing.address} — ${reason}`);
    }
    console.log('\nDry run: nothing sent, nothing saved.');
    return;
  }

  const nextEntries = prune({ ...entries });
  for (const { listing } of matched) nextEntries[listing.id] = listing.closesAt;

  // A first run would otherwise fire every currently-open listing at once. Seed
  // silently instead, so the first real alert is a genuinely new home.
  if (seedOnly || isFirstRun) {
    await writeSeen(nextEntries);
    console.log(`Seeded ${Object.keys(nextEntries).length} listings as already seen. No alerts sent.`);
    return;
  }

  if (fresh.length) {
    await notify(webhookUrl, fresh);
    console.log(`Sent ${fresh.length} alert${fresh.length === 1 ? '' : 's'}:`);
    for (const listing of fresh) console.log(`  ${listing.city}, ${listing.address} — ${listing.url}`);
  } else {
    console.log('No new listings.');
  }

  await writeSeen(nextEntries);
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
