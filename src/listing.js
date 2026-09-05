// Turns a raw portal publication record into the flat shape the rest of the
// tool works with. Everything downstream (filtering, Discord messages, the
// seen-store) reads these fields and never the portal's own naming.

const DETAIL_URL = 'https://utrecht.mijndak.nl/HuisDetails?PublicatieId=';

// The portal ships numbers as strings ("713.02", "0.00").
const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function formatAddress({ Straatnaam, Huisnummer, Huisletter, HuisnummerToevoeging }) {
  return [Straatnaam, Huisnummer, Huisletter, HuisnummerToevoeging]
    .filter((part) => part !== '' && part != null)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalize(raw) {
  const { Adres: adres, Eenheid: eenheid } = raw;

  // "Loting" and "vrije sector" are independent axes, not one category: a home
  // can be a vrije-sector home that is allocated by lottery.
  const isLoting = raw.PublicatieModel === 'Lotingmodel';
  const isVrijeSector = raw.PublicatieModule === 'Vrije sector';

  // DAK has a Koop tab (corporations selling homes, occasionally below market).
  // It is empty in regio Utrecht most of the time, so the exact module name has
  // never been observed; match anything that says koop and route it to the koop
  // channel instead of letting it leak into the huur alerts with a rent of 0.
  const isKoop = /koop/i.test(
    `${raw.PublicatieModule} ${raw.PublicatieModel} ${eenheid.Bestemming ?? ''}`,
  );
  const cluster = raw.Cluster ?? {};
  const price = cluster.PrijsMinBekend ? num(cluster.PrijsMin) : null;

  return {
    id: raw.Id,
    url: DETAIL_URL + raw.Id,
    address: formatAddress(adres),
    postcode: adres.Postcode,
    city: adres.Woonplaats,
    district: adres.Wijk,

    rent: num(eenheid.NettoHuur),
    grossRent: num(eenheid.Brutohuur),
    rooms: eenheid.AantalKamers,
    area: num(eenheid.WoonVertrekkenTotOpp) || num(eenheid.TotaleOppervlakte),

    type: eenheid.DetailSoort,
    energyLabel: eenheid.EnergieLabel,
    landlord: eenheid.Eigenaar,
    floor: raw.Verdieping,
    hasElevator: raw.HeeftLift,
    accessibility: eenheid.Toegankelijkheid,

    // Doelgroep is who the home is *suited* for; label is the hard restriction
    // the portal advertises on the card ("Jongeren", "Senioren", or none).
    targetGroup: eenheid.Doelgroep,
    label: raw.PublicatieLabel || '',
    contract: raw.ContractVorm,

    isLoting,
    isVrijeSector,
    isSocialHousing: raw.PublicatieModule === 'Sociale huur',
    isKoop,
    price,

    publishedAt: raw.PublicatieDatum,
    closesAt: raw.EinddatumTijd,
    photo: raw.Foto_Locatie || null,
    lat: num(eenheid.Breedtegraad) || null,
    lon: num(eenheid.Lengtegraad) || null,
  };
}
