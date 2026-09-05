# WoningNet watcher — DĀK regio Utrecht

Polls the public woningaanbod of [utrecht.mijndak.nl](https://utrecht.mijndak.nl/Woningaanbod)
every ~10 minutes and posts new listings that match your criteria to Discord.

Runs entirely on GitHub Actions. No server, no database, no account anywhere —
free, permanently.

## Before you start: what this actually buys you

Regular WoningNet aanbod (`Aanbodmodel`) is allocated by **inschrijfduur**, not
by who reacts first. Reacting four minutes after publication instead of four
hours makes no difference to your position on the list.

Where speed genuinely matters:

- **Loting** — allocated by lottery, inschrijfduur is irrelevant. Orange in Discord.
- **Vrije sector / middenhuur** — often first-come-first-served, no inschrijfduur
  needed at all. Purple in Discord.

For everything else, the value here is *coverage*: you never miss a match and
you never have to open the site. That is worth having, but set expectations
accordingly.

## Setup

### 1. Create a Discord webhook

In any Discord server you own (make one if needed — it takes ten seconds):

**Server Settings → Integrations → Webhooks → New Webhook** → pick a channel →
**Copy Webhook URL**.

Treat that URL like a password: anyone who has it can post to your channel.

### 2. Put it in the repo

Push this repo to GitHub, then go to
**Settings → Secrets and variables → Actions → New repository secret**:

- Name: `DISCORD_WEBHOOK_URL`
- Value: the URL you copied

### 3. Enable Actions

**Settings → Actions → General → Workflow permissions** → select
**Read and write permissions**. The workflow commits `data/seen.json` back to
the repo, which is how it remembers what it already alerted you about.

Then open the **Actions** tab and enable workflows if GitHub asks.

### 4. First run

Run the workflow once manually (**Actions → Watch woningaanbod → Run workflow**).
The first run *seeds* — it records everything currently online as "already seen"
without alerting, so you don't get 27 notifications at once. From then on you
only hear about genuinely new listings.

## Tuning `config.json`

| Key | Meaning |
| --- | --- |
| `cities` | Only these woonplaatsen. Empty = everywhere in the regio. |
| `excludeCities` | Never these woonplaatsen. |
| `minRent` / `maxRent` | Netto huur in euros. |
| `minRooms` | Minimum aantal kamers. |
| `minArea` / `maxArea` | Woonoppervlakte in m². `null` = no limit. |
| `types` / `excludeTypes` | Woningtype: `Galerijflat`, `Portiekflat`, `Tussenwoning`, `Bovenwoning`, `Benedenwoning`, `Maisonnette`, `Corridorflat`, `Hoekwoning`, `Eindwoning`. |
| `excludeLabels` | Hard restrictions on the card: `Senioren`, `Jongeren`. |
| `targetGroups` | Doelgroep: `Gezin`, `Senioren`, `Jongeren`, `Meergezins`. Empty = all. |
| `includeSocialHousing` | Include sociale huur. |
| `includeVrijeSector` | Include vrije sector (rents well above the social cap). |
| `onlyLoting` | Only lottery listings — the lowest-noise, highest-value setting. |
| `requireElevator` | Only homes with a lift. |
| `minEnergyLabel` | e.g. `"C"` — rejects D and worse. Unknown labels are kept. |

The shipped defaults suit a single person on a social-housing income: everything
up to €933 (the 2026 liberalisatiegrens), 2+ rooms, no senior-restricted homes.

**Note on `Jongeren` listings:** these usually cap at 23 or 28 and come with a
`Jongerencontract` (temporary). At 28 you are on the boundary — the tool passes
them through, but check the actual age limit on the listing itself.

To see the effect of a change without sending anything:

```bash
node src/index.js --dry-run
```

It prints every match *and* every skipped listing with the reason it was
rejected — so if the filters are too tight, you can see it immediately.

## Commands

```bash
npm run dry-run
```

```bash
npm run seed
```

```bash
npm run check
```

`dry-run` reports only. `seed` marks everything currently online as seen
without alerting. `check` is the real thing.

For local runs, put the webhook in a `.env` file (gitignored, never committed):

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Requires Node 22+ and no dependencies at all.

## How it works

`utrecht.mijndak.nl` is an OutSystems app whose logged-out aanbod screen is
backed by a JSON endpoint. No login and no HTML scraping is involved, but the
endpoint only answers a request that looks like the real client, so each run
bootstraps:

1. an anonymous session (`nr1Users` / `nr2Users` cookies)
2. the CSRF token, which is embedded inside the `nr2Users` cookie value
3. `moduleVersion`, from `/moduleservices/moduleversioninfo`
4. `apiVersion`, read out of the portal's own generated JavaScript
5. the region, via an app-ready call that takes the site origin and returns the
   samenwerkingsverband — without this the backend returns success and an
   **empty list**

Steps 3 and 4 rotate on every deploy of the portal, so they are always read
fresh rather than hardcoded. If the portal changes structurally the run fails
loudly with a message pointing at what to re-inspect, instead of quietly
reporting zero listings forever.

## Maintenance

- GitHub disables scheduled workflows in repos with **no commits for 60 days**.
  This one commits `data/seen.json` whenever listings change, so it keeps itself
  alive under normal use.
- If alerts stop, check the Actions tab. A failed run with
  "Could not find the apiVersion" means the portal was restructured and
  `src/dak.js` needs re-inspecting.
- The portal is polled about 144 times a day — comparable to leaving the site
  open in a browser tab, and far below anything that would look abusive.
