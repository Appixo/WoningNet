# WoningNet watcher — DĀK regio Utrecht + koopkansen

Two watchers in one repo, each with its own Discord channel:

- **huur** — polls the public woningaanbod of [utrecht.mijndak.nl](https://utrecht.mijndak.nl/Woningaanbod)
  every ~10 minutes and posts new sociale-huur / vrije-sector listings that
  match your criteria.
- **koop** — polls [nieuwbouw.nl](https://nieuwbouw.nl) hourly for nieuwbouw
  projects inside an area you draw on the map and under a price ceiling, plus
  anything DĀK itself lists under Koop. Alerts when a project appears and again
  when its sale opens.

Runs entirely on GitHub Actions. No server, no database, no account anywhere —
free, permanently.

## Before you start: what this actually buys you

### Huur

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

### Koop

Nieuwbouw is sold at a fixed v.o.n. price and usually allocated by
**inschrijving + loting** in the first days after the sale opens. Signing up is
free. That is the moment this channel is built around: the red alert
"Verkoop gestart" means go to the project site and register now.

Be realistic about what it is for. Nearly every nieuwbouw project in the region
comes with a **zelfbewoningsplicht** and an anti-speculatiebeding, and buying
without living there costs 8% overdrachtsbelasting instead of 0%. This channel
finds homes to **buy, live in and build equity in** — not flips. The DĀK Koop
tab (corporations selling homes, sometimes with Koopgarant discounts) is
included on the same terms; it is empty most of the time.

## Setup

### 1. Create two Discord webhooks

In any Discord server you own (make one if needed — it takes ten seconds),
create two channels, e.g. `#huur` and `#koop`. For each:

**Server Settings → Integrations → Webhooks → New Webhook** → pick the channel →
**Copy Webhook URL**.

Treat those URLs like passwords: anyone who has one can post to your channel.

### 2. Put them in the repo

Push this repo to GitHub, then go to
**Settings → Secrets and variables → Actions → New repository secret**:

- `DISCORD_WEBHOOK_URL` — the huur webhook
- `DISCORD_WEBHOOK_URL_KOOP` — the koop webhook

The koop channel silently sits out any run where its secret is missing, so the
huur alerts keep working while you set it up.

### 3. Enable Actions

**Settings → Actions → General → Workflow permissions** → select
**Read and write permissions**. The workflow commits `data/seen.json` and
`data/seen-koop.json` back to the repo, which is how it remembers what it
already alerted you about.

Then open the **Actions** tab and enable workflows if GitHub asks.

### 4. First run

Run the workflow once manually (**Actions → Watch woningaanbod → Run workflow**).

- **Huur** *seeds* on its first run — it records everything currently online as
  "already seen" without alerting, so you don't get 39 notifications at once.
- **Koop** ships with an empty store on purpose, so the first run posts the
  handful of projects currently matching (five at the time of writing). That is
  your confirmation the channel works. To start silent instead, run
  `npm run seed` once locally and commit `data/seen-koop.json`.

## Tuning `config.json` — huur

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

## Tuning `config.json` — koop

Everything under the `koop` key.

| Key | Meaning |
| --- | --- |
| `enabled` | `false` switches the channel off entirely. |
| `intervalMinutes` | How often nieuwbouw.nl is polled. Default 60; the site changes a few times a week, not a few times an hour. |
| `municipalities` | Gemeente slugs as used in `nieuwbouw.nl/aanbod/koop/<slug>`. Shipped: `stichtse-vecht`, `utrecht`, `wijdemeren`. |
| `maxPrice` | Compared against the **cheapest** unit in a project: a project is interesting if anything in it is affordable. Projects with unknown prices are kept. |
| `minPrice` | Drops projects whose most expensive unit is below this. Usually 0. |
| `excludeTypes` | Drops projects that consist *only* of these types. Shipped: kavels. |
| `excludeStatuses` | Shipped: `Verkocht`, `Uitverkocht`, `Opgeleverd`. |
| `places` | Optional whitelist of woonplaatsen (`Maarssen`, `Vleuten`, …). Empty = rely on `area`. |
| `area` | Polygon of `[lat, lon]` points. Projects outside it are dropped; projects without coordinates are kept. Empty = no area filter. |

The shipped `area` is the Vecht corridor: Loenen aan de Vecht, Loosdrecht and
Kortenhoef in the north, down past Breukelen and Maarssen to Vleuten and
Leidsche Rijn. Utrecht's inner city and Merwede fall outside it on purpose; the
`utrecht` slug is there for Leidsche Rijn, Vleuten and Haarzuilens.

To redraw it: right-click points on Google Maps in order around your area, copy
the coordinates it shows (they are already `lat, lon`), paste them as the new
list. Ten to fifteen points is plenty.

**What triggers a koop alert**

- A project appears inside the filters for the first time (green when in sale,
  yellow when only announced — announced projects are worth registering
  interest in on the project website, that is often how the inschrijving list is
  built).
- A tracked project moves from announced to **in verkoop** (red). This is the
  one to act on the same day.
- A DĀK koop publication (teal).

A price drop or a status change *between* sale phases does not alert.

To see the effect of a change without sending anything:

```bash
node src/index.js --dry-run
```

It prints every match *and* every skipped listing or project with the reason it
was rejected — so if the filters are too tight, you can see it immediately.

## Commands

```bash
npm run dry-run
```

```bash
npm run dry-run:koop
```

```bash
npm run seed
```

```bash
npm run check
```

`dry-run` reports only (`dry-run:huur` / `dry-run:koop` for one channel).
`seed` marks everything currently online as seen without alerting, for both
channels. `check` is the real thing. Add `--only=huur` or `--only=koop` to any
of them to run a single channel.

For local runs, put the webhooks in a `.env` file (gitignored, never committed):

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_URL_KOOP=https://discord.com/api/webhooks/...
```

Requires Node 22+ and no dependencies at all.

## How it works

### Huur — DĀK

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

The same response carries the Koop tab. Anything on it is routed to the koop
channel rather than the huur alerts. The tab has been empty every time it was
inspected, so the exact field layout of a koop publication is a best guess;
if one ever shows up with a missing price, that is why.

### Koop — nieuwbouw.nl

nieuwbouw.nl is a Livewire app, but its per-gemeente list pages are fully
server-rendered: every project card is in the HTML with a stable id, 18 per
page. The watcher reads name, place, wijk, types, price range, availability and
status straight off the cards. For projects that pass the price and status
filters it fetches the detail page **once** to get coordinates (for the area
filter), sale/delivery dates and the developer, and caches that in
`data/seen-koop.json`.

Funda and Jaap answer scripts with a captcha, which is why existing homes for
sale are not covered. If you want a renovation-project feed, that needs a
source that does not block bots.

Both channels fail independently: a DĀK outage does not stop the koop check and
vice versa. The run exits non-zero if either failed, so it shows up red in the
Actions tab.

## Maintenance

- GitHub disables scheduled workflows in repos with **no commits for 60 days**.
  This one commits `data/*.json` whenever listings change, so it keeps itself
  alive under normal use.
- If huur alerts stop, check the Actions tab. A failed run with
  "Could not find the apiVersion" means the portal was restructured and
  `src/dak.js` needs re-inspecting.
- If koop dry-runs start reporting 0 projects for a gemeente that clearly has
  some, nieuwbouw.nl changed its card markup; re-inspect `src/nieuwbouw.js`.
- DĀK is polled about 144 times a day and nieuwbouw.nl about 24 times a day
  (three or four pages each) — comparable to leaving the sites open in a browser
  tab, and far below anything that would look abusive.
