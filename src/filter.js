// Applies config.json to a normalized listing.
//
// Every rule reports *why* it rejected, so `npm run dry-run` can explain the
// listings it skipped. That matters more than it sounds: a silent watcher that
// filters too aggressively looks exactly like a watcher that is working fine.

const ENERGY_ORDER = ['A+++', 'A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const includesAny = (haystack, needle) => haystack.some((h) => eq(h, needle));

/** @returns {{ matched: boolean, reason?: string }} */
export function matches(listing, config) {
  const reject = (reason) => ({ matched: false, reason });

  if (listing.isKoop) {
    return reject('koopwoning (handled by the koop channel)');
  }

  if (config.cities?.length && !includesAny(config.cities, listing.city)) {
    return reject(`city ${listing.city} not in cities`);
  }
  if (config.excludeCities?.length && includesAny(config.excludeCities, listing.city)) {
    return reject(`city ${listing.city} is excluded`);
  }

  if (listing.rent < (config.minRent ?? 0)) {
    return reject(`rent EUR${listing.rent} below minRent`);
  }
  if (config.maxRent != null && listing.rent > config.maxRent) {
    return reject(`rent EUR${listing.rent} above maxRent EUR${config.maxRent}`);
  }

  if (listing.rooms < (config.minRooms ?? 0)) {
    return reject(`${listing.rooms} rooms below minRooms`);
  }
  if (listing.area < (config.minArea ?? 0)) {
    return reject(`${listing.area}m2 below minArea`);
  }
  if (config.maxArea != null && listing.area > config.maxArea) {
    return reject(`${listing.area}m2 above maxArea`);
  }

  if (config.types?.length && !includesAny(config.types, listing.type)) {
    return reject(`type ${listing.type} not in types`);
  }
  if (config.excludeTypes?.length && includesAny(config.excludeTypes, listing.type)) {
    return reject(`type ${listing.type} is excluded`);
  }

  // A label is the portal's hard restriction on the card ("Senioren" means you
  // will not get it at 28), so this is the filter that saves the most noise.
  if (listing.label && config.excludeLabels?.length && includesAny(config.excludeLabels, listing.label)) {
    return reject(`label ${listing.label} is excluded`);
  }
  if (config.targetGroups?.length && !includesAny(config.targetGroups, listing.targetGroup)) {
    return reject(`doelgroep ${listing.targetGroup} not in targetGroups`);
  }

  if (config.onlyLoting && !listing.isLoting) {
    return reject('not a loting listing');
  }
  if (listing.isVrijeSector && !config.includeVrijeSector) {
    return reject('vrije sector excluded');
  }
  if (listing.isSocialHousing && !config.includeSocialHousing) {
    return reject('sociale huur excluded');
  }

  if (config.requireElevator && !listing.hasElevator) {
    return reject('no elevator');
  }

  if (config.minEnergyLabel) {
    const want = ENERGY_ORDER.indexOf(config.minEnergyLabel);
    const have = ENERGY_ORDER.indexOf(listing.energyLabel);
    // An unknown label is kept rather than dropped — a missing field should
    // never hide a home that might be fine.
    if (want !== -1 && have !== -1 && have > want) {
      return reject(`energy label ${listing.energyLabel} worse than ${config.minEnergyLabel}`);
    }
  }

  return { matched: true };
}
