import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';

// Current weather for the Command Center hero, via Open-Meteo (free, no API key).
// Location comes from the company settings (city/state/zip). Geocoding is cached in
// module memory keyed on the settings string; the forecast is cached for 15 minutes
// (with a short negative cache so a flaky network doesn't hammer the API on every
// brief poll). Every failure path returns null — the widget simply doesn't render.

export interface BriefWeather {
  tempF: number;   // current temperature
  hiF: number;     // today's high
  loF: number;     // today's low
  rainPct: number; // today's max precipitation probability (0-100)
  code: number;    // WMO weather code
  label: string;   // "Sunny", "Light rain", …
  emoji: string;   // ☀️ 🌧️ …
  city: string;    // resolved geocode name, e.g. "Eustis"
}

/** WMO weather code → human label + emoji. Pure, for unit tests. */
export function describeWeatherCode(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Sunny', emoji: '☀️' };
  if (code === 1) return { label: 'Mostly sunny', emoji: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', emoji: '⛅' };
  if (code === 3) return { label: 'Overcast', emoji: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', emoji: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', emoji: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Showers', emoji: '🌧️' };
  if (code >= 95) return { label: 'Thunderstorm', emoji: '⛈️' };
  return { label: 'Cloudy', emoji: '☁️' };
}

const TTL_MS = 15 * 60_000;      // serve a good reading for 15 minutes
const FAIL_TTL_MS = 2 * 60_000;  // first retry 2 minutes after a failure
const MAX_FAIL_TTL_MS = 60 * 60_000; // …doubling up to an hour while it keeps failing
const RATE_LIMIT_TTL_MS = 30 * 60_000; // a 429 with no Retry-After: wait half an hour
const STALE_OK_MS = 6 * 60 * 60_000; // keep showing the last good reading for 6 hours
const FETCH_TIMEOUT_MS = 5_000;

/** Carries the HTTP status so the backoff can treat rate limiting differently. */
export class ForecastHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number | null) {
    super(`forecast HTTP ${status}`);
  }
}

/** Retry-After is either delta-seconds or an HTTP date. Null when absent/unparseable. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * How long to wait before the next attempt after `failures` consecutive failures.
 *
 * The old flat 2-minute backoff was shorter than the 15-minute success TTL, so a rate
 * limit made the app hit Open-Meteo *harder* than when it was working — ~30 calls an
 * hour, all rejected, which is what kept it rate-limited. Back off exponentially, and
 * on a 429 start at the server's Retry-After (or half an hour) instead.
 */
export function backoffMs(failures: number, err?: unknown): number {
  if (err instanceof ForecastHttpError && err.status === 429) {
    return Math.min(err.retryAfterMs ?? RATE_LIMIT_TTL_MS, MAX_FAIL_TTL_MS);
  }
  return Math.min(FAIL_TTL_MS * 2 ** Math.max(0, failures - 1), MAX_FAIL_TTL_MS);
}

// Shop location fallback (Eustis, FL) so weather works even when the company
// city/zip settings are empty or the geocoder is unreachable.
const DEFAULT_LOC = { lat: 28.8528, lon: -81.6856, name: 'Eustis' };

let geo: { key: string; lat: number; lon: number; name: string } | null = null;
let wx: { at: number; ttl: number; data: BriefWeather | null } | null = null;
let inflight: Promise<BriefWeather | null> | null = null;
let failures = 0;
let lastGood: { at: number; data: BriefWeather } | null = null;

/** Reset module caches. Test-only. */
export function __resetWeatherCache(): void {
  geo = null; wx = null; inflight = null; failures = 0; lastGood = null;
}

/**
 * Resolve the company location to lat/lon, cached until the settings change.
 * Falls back to the shop's coordinates when settings are empty or geocoding fails —
 * weather should degrade to "shop weather", never disappear.
 */
async function resolveLocation(): Promise<{ lat: number; lon: number; name: string }> {
  const [city, state, zip] = await Promise.all([
    getSetting('company_city'), getSetting('company_state'), getSetting('company_zip'),
  ]);
  const query = (city || zip || '').trim();
  if (!query) return DEFAULT_LOC;
  const key = `${city}|${state}|${zip}`;
  if (geo && geo.key === key) return geo;

  try {
    const resp = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!resp.ok) throw new Error(`geocoding HTTP ${resp.status}`);
    const json = (await resp.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country_code?: string }>;
    };
    const us = (json.results || []).filter(r => (r.country_code || '').toUpperCase() === 'US');
    if (!us.length) {
      logger.warn({ query }, '[weather] geocoding returned no US results — using shop location');
      return DEFAULT_LOC;
    }
    // Prefer a result in the company's state when one matches; otherwise take the top hit.
    const wantState = (state || '').trim().toLowerCase();
    const pick = (wantState && us.find(r => (r.admin1 || '').toLowerCase().startsWith(wantState.slice(0, 4)))) || us[0];
    geo = { key, lat: pick.latitude, lon: pick.longitude, name: pick.name };
    return geo;
  } catch (err) {
    logger.warn({ err, query }, '[weather] geocoding failed — using shop location');
    return DEFAULT_LOC;
  }
}

async function fetchWeather(): Promise<BriefWeather | null> {
  const loc = await resolveLocation();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1';
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) {
    throw new ForecastHttpError(resp.status, parseRetryAfter(resp.headers.get('retry-after')));
  }
  const json = (await resp.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] };
  };
  const cur = json.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return null;
  const code = cur.weather_code ?? 3;
  const { label, emoji } = describeWeatherCode(code);
  return {
    tempF: cur.temperature_2m,
    hiF: json.daily?.temperature_2m_max?.[0] ?? cur.temperature_2m,
    loF: json.daily?.temperature_2m_min?.[0] ?? cur.temperature_2m,
    rainPct: json.daily?.precipitation_probability_max?.[0] ?? 0,
    code, label, emoji,
    city: loc.name,
  };
}

/**
 * Cached current weather for the company location. Never throws.
 *
 * While a refresh is failing, keep serving the last good reading for up to
 * STALE_OK_MS — six-hour-old weather beats the widget vanishing for an hour
 * because Open-Meteo rate-limited one poll.
 */
export async function getWeather(): Promise<BriefWeather | null> {
  if (wx && Date.now() - wx.at < wx.ttl) return wx.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchWeather();
      failures = 0;
      if (data) lastGood = { at: Date.now(), data };
      wx = { at: Date.now(), ttl: data ? TTL_MS : FAIL_TTL_MS, data };
      return data;
    } catch (err) {
      failures++;
      const ttl = backoffMs(failures, err);
      const stale = lastGood && Date.now() - lastGood.at < STALE_OK_MS ? lastGood.data : null;
      logger.warn(
        { err, failures, retryInMs: ttl, servingStale: Boolean(stale) },
        '[weather] fetch failed'
      );
      wx = { at: Date.now(), ttl, data: stale };
      return stale;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
