// Discord webhook delivery.
//
// One embed per home or project, batched 10 at a time (Discord's hard cap per
// message). A webhook needs no bot, no OAuth and no hosting — just the URL.
// The huur and koop channels each have their own webhook, so each can go to
// its own Discord channel and be muted or shared independently.

const EMBEDS_PER_MESSAGE = 10;

const euro = (amount) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);

function formatDeadline(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'onbekend';
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  }).format(date);
}

async function post(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Discord answers 429 with the wait time; one retry is enough at this volume.
  if (res.status === 429) {
    const { retry_after: retryAfter = 2 } = await res.json().catch(() => ({}));
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.5) * 1000));
    return post(webhookUrl, payload);
  }

  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}: ${await res.text()}`);
  }
}

async function send(webhookUrl, header, embeds) {
  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    await post(webhookUrl, {
      content: i === 0 ? header : undefined,
      embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE),
      allowed_mentions: { parse: [] },
    });
  }
}

// ---------------------------------------------------------------- huur ----

function huurColor(listing) {
  if (listing.isLoting) return 0xf5a623;      // orange — speed genuinely matters
  if (listing.isVrijeSector) return 0x9b51e0; // purple — no inschrijfduur needed
  return 0x2f80ed;                            // blue — regular aanbod
}

function huurTags(listing) {
  const tags = [];
  if (listing.isLoting) tags.push('LOTING');
  if (listing.isVrijeSector) tags.push('VRIJE SECTOR');
  if (listing.isNieuwbouw) tags.push('NIEUWBOUW');
  if (listing.label) tags.push(listing.label.toUpperCase());
  return tags;
}

function huurEmbed(listing) {
  return {
    title: `${listing.address}, ${listing.city}`,
    url: listing.url,
    description: [listing.district, huurTags(listing).join(' · ')].filter(Boolean).join('\n'),
    color: huurColor(listing),
    fields: [
      { name: 'Huur', value: euro(listing.rent), inline: true },
      { name: 'Kamers', value: String(listing.rooms), inline: true },
      { name: 'Oppervlakte', value: `${listing.area} m²`, inline: true },
      { name: 'Type', value: listing.type || 'onbekend', inline: true },
      { name: 'Energielabel', value: listing.energyLabel || 'onbekend', inline: true },
      { name: 'Verhuurder', value: listing.landlord || 'onbekend', inline: true },
      { name: 'Reageren tot', value: formatDeadline(listing.closesAt), inline: false },
    ],
    ...(listing.photo ? { image: { url: listing.photo } } : {}),
    footer: { text: `DĀK regio Utrecht · id ${listing.id}` },
    timestamp: listing.publishedAt,
  };
}

export async function notifyHuur(webhookUrl, listings) {
  if (!listings.length) return;
  const n = listings.length;
  await send(webhookUrl, `🏠 **${n} nieuwe woning${n === 1 ? '' : 'en'}** in regio Utrecht`, listings.map(huurEmbed));
}

// ---------------------------------------------------------------- koop ----

const OPEN_STATUS = /verkoop|verhuur|inschrijv|beschikbaar/i;

function koopColor(event) {
  if (event.item.source === 'DĀK') return 0x00b8d9;     // teal — corporation selling
  if (event.kind === 'sale-start') return 0xeb5757;     // red — just opened, act now
  if (OPEN_STATUS.test(event.item.status)) return 0x27ae60; // green — open
  return 0xf2c94c;                                      // yellow — announced, register interest
}

function koopEmbed(event, kind) {
  const { item } = event;
  const detail = item.detail ?? {};
  const dates = detail.dates ?? {};
  const isHuur = kind === 'huur';

  const headline =
    event.kind === 'sale-start'
      ? `🔔 **${isHuur ? 'Verhuur' : 'Verkoop'} gestart** (was: ${event.from})`
      : item.source === 'DĀK'
        ? '🏷️ Koopwoning via DĀK'
        : `🆕 Nieuw ${isHuur ? 'huurproject' : 'project'} · ${item.status}`;

  const fields = [
    { name: isHuur ? 'Huur' : 'Prijs', value: item.priceText || 'op aanvraag', inline: true },
    { name: 'Woningen', value: item.availability || 'onbekend', inline: true },
    { name: 'Status', value: item.status, inline: true },
  ];
  if (dates.voorverkoop) fields.push({ name: 'Voorverkoop', value: dates.voorverkoop, inline: true });
  if (dates.startVerkoop) fields.push({ name: 'Start verkoop', value: dates.startVerkoop, inline: true });
  if (dates.oplevering) fields.push({ name: 'Oplevering', value: dates.oplevering, inline: true });
  if (detail.developer) fields.push({ name: 'Ontwikkelaar', value: detail.developer, inline: true });

  return {
    title: `${item.name} — ${item.place}`,
    url: item.url,
    description: [headline, [item.district, item.types].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    color: koopColor(event),
    fields,
    ...(item.photo ? { image: { url: item.photo } } : {}),
    footer: {
      text: [item.source, item.municipality ? `gemeente ${item.municipality}` : null, item.id].filter(Boolean).join(' · '),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function notifyProjects(webhookUrl, events, kind = 'koop') {
  if (!events.length) return;
  const n = events.length;
  const started = events.filter((e) => e.kind === 'sale-start').length;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const header =
    kind === 'huur'
      ? started
        ? `🏗️ **${plural(started, 'nieuwbouw-huurproject', 'nieuwbouw-huurprojecten')} in verhuur gegaan** — inschrijven kan nu`
        : `🏗️ **${plural(n, 'nieuw nieuwbouw-huurproject', 'nieuwe nieuwbouw-huurprojecten')}** in jouw gebied`
      : started
        ? `🏗️ **${plural(started, 'project', 'projecten')} in verkoop gegaan** — inschrijven kan nu`
        : `🏗️ **${plural(n, 'nieuwe koopkans', 'nieuwe koopkansen')}** in jouw gebied`;
  await send(webhookUrl, header, events.map((event) => koopEmbed(event, kind)));
}
