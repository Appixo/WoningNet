// Discord webhook delivery.
//
// One embed per home, batched 10 at a time (Discord's hard cap per message).
// A webhook needs no bot, no OAuth and no hosting — just the URL, kept in the
// DISCORD_WEBHOOK_URL secret.

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

function colorFor(listing) {
  if (listing.isLoting) return 0xf5a623;      // orange — speed genuinely matters
  if (listing.isVrijeSector) return 0x9b51e0; // purple — no inschrijfduur needed
  return 0x2f80ed;                            // blue — regular aanbod
}

function tagsFor(listing) {
  const tags = [];
  if (listing.isLoting) tags.push('LOTING');
  if (listing.isVrijeSector) tags.push('VRIJE SECTOR');
  if (listing.label) tags.push(listing.label.toUpperCase());
  return tags;
}

function toEmbed(listing) {
  const tags = tagsFor(listing);

  const fields = [
    { name: 'Huur', value: euro(listing.rent), inline: true },
    { name: 'Kamers', value: String(listing.rooms), inline: true },
    { name: 'Oppervlakte', value: `${listing.area} m²`, inline: true },
    { name: 'Type', value: listing.type || 'onbekend', inline: true },
    { name: 'Energielabel', value: listing.energyLabel || 'onbekend', inline: true },
    { name: 'Verhuurder', value: listing.landlord || 'onbekend', inline: true },
    { name: 'Reageren tot', value: formatDeadline(listing.closesAt), inline: false },
  ];

  return {
    title: `${listing.address}, ${listing.city}`,
    url: listing.url,
    description: [listing.district, tags.join(' · ')].filter(Boolean).join('\n'),
    color: colorFor(listing),
    fields,
    ...(listing.photo ? { image: { url: listing.photo } } : {}),
    footer: { text: `DĀK regio Utrecht · id ${listing.id}` },
    timestamp: listing.publishedAt,
  };
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

export async function notify(webhookUrl, listings) {
  if (!listings.length) return;

  for (let i = 0; i < listings.length; i += EMBEDS_PER_MESSAGE) {
    const batch = listings.slice(i, i + EMBEDS_PER_MESSAGE);
    const isFirst = i === 0;

    await post(webhookUrl, {
      content: isFirst
        ? `🏠 **${listings.length} nieuwe woning${listings.length === 1 ? '' : 'en'}** in regio Utrecht`
        : undefined,
      embeds: batch.map(toEmbed),
      allowed_mentions: { parse: [] },
    });
  }
}
