// Client for the public (logged-out) DAK / WoningNet aanbod API.
//
// The portal is an OutSystems Reactive app. Its screen services are plain JSON
// POST endpoints, but they only answer a request that looks exactly like the
// real client, so every run has to bootstrap:
//
//   1. an anonymous session (cookies nr1Users + nr2Users)
//   2. the CSRF token, which is embedded inside the nr2Users cookie value
//   3. moduleVersion  - global, from /moduleservices/moduleversioninfo
//   4. apiVersion     - per action, baked into the generated client JS
//   5. the region, via an "application ready" call that takes the site Origin
//      and answers with the samenwerkingsverband (Regio Utrecht = id 1, UTR)
//
// Step 5 matters most: without it the backend happily returns IsSuccess with an
// empty list, because the query has no region bound to it. The region then has
// to be echoed back in clientVariables on the aanbod call itself.
//
// moduleVersion and apiVersion rotate on every deploy of the portal, so they are
// always read fresh — hardcoding them means silently returning zero results
// after the portal's next release.

import { buildScreenVariables } from './payload.js';

const ORIGIN = 'https://utrecht.mijndak.nl';
const SCREEN_JS = '/scripts/DAKWP.Overzicht.Woningaanbod.mvc.js';
const MODULE_JS = '/scripts/DAKWP.controller.js';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const baseHeaders = () => ({
  'Content-Type': 'application/json; charset=UTF-8',
  Accept: 'application/json',
  'OutSystems-locale': 'nl-NL',
  'User-Agent': UA,
});

// Both callDataAction(...) and callServerAction(...) register as
//   ("<name>", "<endpoint>", "<apiVersion>", ...
function findApiVersion(js, actionName, source) {
  const pattern = new RegExp(`"${actionName}",\\s*"[^"]*",\\s*"([^"]+)"`);
  const match = pattern.exec(js);
  if (!match) {
    throw new Error(
      `Could not find the apiVersion for ${actionName} in ${source}. ` +
        'The portal was probably restructured — re-inspect the generated client JS.',
    );
  }
  return match[1];
}

async function getText(path) {
  const res = await fetch(ORIGIN + path, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${path} returned ${res.status}`);
  return res.text();
}

// nr2Users looks like: crf%3d<token>%3buid%3d0%3bunm%3d
function csrfFromCookie(nr2Users) {
  const match = /crf=([^;]+)/.exec(decodeURIComponent(nr2Users));
  if (!match) throw new Error('Could not extract CSRF token from the nr2Users cookie');
  return match[1];
}

// The first call 403s for anonymous visitors, but it is what mints the cookies.
async function openSession() {
  const res = await fetch(`${ORIGIN}/screenservices/DAKWP/ActionOnApplicationReadyServerActions`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({
      versionInfo: { moduleVersion: '', apiVersion: '' },
      viewName: '',
      inputParameters: {},
    }),
  });

  const jar = {};
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  if (!jar.nr2Users) throw new Error('Portal did not hand out a session cookie');

  return {
    cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    csrf: csrfFromCookie(jar.nr2Users),
  };
}

function makeCaller({ cookie, csrf }) {
  return async function call(path, body) {
    const res = await fetch(ORIGIN + path, {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        'X-CSRFToken': csrf,
        Cookie: cookie,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/Woningaanbod`,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (json.exception) {
      throw new Error(`${path} was rejected: ${json.exception.message}`);
    }
    if (json.versionInfo?.hasApiVersionChanged || json.versionInfo?.hasModuleVersionChanged) {
      throw new Error(
        `${path}: version tokens went stale mid-request (the portal deployed). ` +
          'This resolves itself on the next run.',
      );
    }
    return json.data ?? {};
  };
}

// Only the handful of client variables the aanbod query actually reads. The app
// sends ~60; the rest are UI preferences the backend ignores.
function clientVariablesFor(swv) {
  return {
    SamenwerkingsverbandId: swv.SamenwerkingsverbandId,
    SamenwerkingsverbandCode: swv.Code,
    SamenwerkingsverbandNaam: swv.Naam,
    CacheVariant: 1,
    MaandenHistorie: -36,
    Weergave_Sortering: 6,
    Weergave_SorteringIsAflopend: true,
    Weergave_GebruikWoonwensFilter: true,
    IsUitgebreidZoeken: false,
    ZoekAanbod: '',
    Username: '',
    SessionToken: '',
  };
}

/**
 * Fetch the full public aanbod for regio Utrecht.
 * Returns the raw publication records, each tagged with the site tab it came
 * from (Aanbod / Loting / VrijeSector / MiddenHuur / Koop / ParkerenOverig).
 */
export async function fetchAanbod() {
  const [session, moduleVersion, screenJs, moduleJs] = await Promise.all([
    openSession(),
    getText('/moduleservices/moduleversioninfo').then((t) => JSON.parse(t).versionToken),
    getText(SCREEN_JS),
    getText(MODULE_JS),
  ]);

  if (!moduleVersion) throw new Error('No versionToken in moduleversioninfo');

  const call = makeCaller(session);

  // Bind this anonymous session to a region. The portal derives it from Origin,
  // so the same code works for any other mijndak.nl region site.
  const ready = await call('/screenservices/DAKWP/ActionOnApplicationReadyServerActions', {
    versionInfo: {
      moduleVersion,
      apiVersion: findApiVersion(moduleJs, 'OnApplicationReadyServerActions', MODULE_JS),
    },
    viewName: '',
    inputParameters: { Origin: ORIGIN },
  });

  const swv = ready.Samenwerkingsverband;
  if (!swv?.SamenwerkingsverbandId) {
    throw new Error('Portal did not resolve a samenwerkingsverband for this origin');
  }

  const data = await call('/screenservices/DAKWP/Overzicht/Woningaanbod/DataActionHaalUitgelogdAanbod', {
    versionInfo: {
      moduleVersion,
      apiVersion: findApiVersion(screenJs, 'DataActionHaalUitgelogdAanbod', SCREEN_JS),
    },
    viewName: 'Overzicht.Woningaanbod',
    screenData: { variables: buildScreenVariables() },
    clientVariables: clientVariablesFor(swv),
  });

  if (data.Result && data.Result.IsSuccess === false) {
    throw new Error(`Portal returned an error: ${data.Result.ErrorMessage || 'unknown'}`);
  }

  const seen = new Map();
  for (const value of Object.values(data)) {
    if (!value || !Array.isArray(value.List)) continue;
    // The portal can repeat a home across lists; Id is the stable key.
    for (const item of value.List) if (!seen.has(item.Id)) seen.set(item.Id, item);
  }

  return { region: swv.Naam, listings: [...seen.values()] };
}
