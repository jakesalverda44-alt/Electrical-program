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
const FAIL_TTL_MS = 2 * 60_000;  // back off for 2 minutes after a failure
const FETCH_TIMEOUT_MS = 5_000;

let geo: { key: string; lat: number; lon: number; name: string } | null = null;
let wx: { at: number; ttl: number; data: BriefWeather | null } | null = null;
let inflight: Promise<BriefWeather | null> | null = null;

/** Resolve the company location to lat/lon, cached until the settings change. */
async function resolveLocation(): Promise<{ lat: number; lon: number; name: string } | null> {
  const [city, state, zip] = await Promise.all([
    getSetting('company_city'), getSetting('company_state'), getSetting('company_zip'),
  ]);
  const query = (city || zip || '').trim();
  if (!query) {
    logger.warn('[weather] company_city/company_zip not set — weather disabled');
    return null;
  }
  const key = `${city}|${state}|${zip}`;
  if (geo && geo.key === key) return geo;

  const resp = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&countryCode=US`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!resp.ok) throw new Error(`geocoding HTTP ${resp.status}`);
  const json = (await resp.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string }> };
  const results = json.results || [];
  if (!results.length) {
    logger.warn({ query }, '[weather] geocoding returned no results');
    return null;
  }
  // Prefer a result in the company's state when one matches; otherwise take the top hit.
  const wantState = (state || '').trim().toLowerCase();
  const pick = (wantState && results.find(r => (r.admin1 || '').toLowerCase().startsWith(wantState.slice(0, 4)))) || results[0];
  geo = { key, lat: pick.latitude, lon: pick.longitude, name: pick.name };
  return geo;
}

async function fetchWeather(): Promise<BriefWeather | null> {
  const loc = await resolveLocation();
  if (!loc) return null;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1';
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`forecast HTTP ${resp.status}`);
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

/** Cached current weather for the company location. Never throws. */
export async function getWeather(): Promise<BriefWeather | null> {
  if (wx && Date.now() - wx.at < wx.ttl) return wx.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchWeather();
      wx = { at: Date.now(), ttl: data ? TTL_MS : FAIL_TTL_MS, data };
      return data;
    } catch (err) {
      logger.warn({ err }, '[weather] fetch failed');
      wx = { at: Date.now(), ttl: FAIL_TTL_MS, data: null };
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
