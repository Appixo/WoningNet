// Entry point. One run = one poll of the sources.
//
//   node src/index.js              check, notify, update the seen-stores
//   node src/index.js --dry-run    show what would happen, send nothing, save nothing
//   node src/index.js --seed       mark everything currently listed as already seen
//   node src/index.js --only=koop  run a single channel (huur or koop)
//
// Two independent channels:
//   huur  DĀK regio Utrecht sociale huur / vrije sector  -> DISCORD_WEBHOOK_URL
//   koop  nieuwbouw.nl projects + DĀK koop               -> DISCORD_WEBHOOK_URL_KOOP
//
// State lives in data/*.json, committed back by the GitHub Action. That is the
// whole persistence layer: no database, no server, nothing to pay for.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAanbod } from './dak.js';
import { normalize } from './listing.js';
import { runHuur } from './huur.js';
import { runKoop } from './koop.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const seedOnly = args.includes('--seed');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
const enabled = (channel) => only === null || only === channel;

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  const failures = [];

  let dak = { region: 'DĀK', listings: [] };
  try {
    const { region, listings } = await fetchAanbod();
    dak = { region, listings: listings.map(normalize) };
  } catch (error) {
    failures.push(`huur: ${error.message}`);
    console.error(`[huur] DĀK fetch failed: ${error.message}`);
  }

  if (enabled('huur') && !failures.length) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl && !dryRun && !seedOnly) {
      throw new Error('DISCORD_WEBHOOK_URL is not set — add it as a repository secret');
    }
    try {
      await runHuur({
        config,
        region: dak.region,
        listings: dak.listings.filter((l) => !l.isKoop),
        storePath: join(ROOT, 'data', 'seen.json'),
        webhookUrl,
        dryRun,
        seedOnly,
      });
    } catch (error) {
      failures.push(`huur: ${error.message}`);
      console.error(`[huur] Failed: ${error.message}`);
    }
  }

  if (enabled('koop') && config.koop?.enabled !== false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL_KOOP;
    if (!webhookUrl && !dryRun && !seedOnly) {
      // The koop channel must never take the huur alerts down with it: without
      // its own webhook it simply sits out this run.
      console.warn('[koop] DISCORD_WEBHOOK_URL_KOOP is not set — skipping the koop channel');
    } else {
      try {
        await runKoop({
          config: config.koop,
          dakKoop: dak.listings.filter((l) => l.isKoop),
          storePath: join(ROOT, 'data', 'seen-koop.json'),
          webhookUrl,
          dryRun,
          seedOnly,
        });
      } catch (error) {
        failures.push(`koop: ${error.message}`);
        console.error(`[koop] Failed: ${error.message}`);
      }
    }
  }

  if (dryRun) console.log('\nDry run: nothing sent, nothing saved.');
  if (failures.length) throw new Error(failures.join('; '));
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
