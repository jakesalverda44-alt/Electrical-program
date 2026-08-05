import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../db/getSetting', () => ({ getSetting: vi.fn().mockResolvedValue('') }));

import { getWeather, __resetWeatherCache } from './weather';

const forecastBody = {
  current: { temperature_2m: 82, weather_code: 0 },
  daily: {
    temperature_2m_max: [91],
    temperature_2m_min: [70],
    precipitation_probability_max: [20],
  },
};

const okResponse = () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => forecastBody,
});

const rateLimited = () => ({
  ok: false,
  status: 429,
  headers: new Headers({ 'retry-after': '600' }),
  json: async () => ({}),
});

describe('getWeather caching under failure', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let now = 1_700_000_000_000;

  beforeEach(() => {
    __resetWeatherCache();
    now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const advance = (ms: number) => { now += ms; };

  it('serves the cached reading without refetching inside the 15 minute TTL', async () => {
    fetchMock.mockResolvedValue(okResponse());

    const first = await getWeather();
    expect(first?.tempF).toBe(82);

    advance(60_000);
    const second = await getWeather();
    expect(second?.tempF).toBe(82);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The regression this guards: a 429 used to blank the widget *and* schedule a retry
  // sooner than a success would, so the app hammered Open-Meteo while rate-limited.
  it('keeps serving the last good reading when a refresh is rate-limited', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    expect((await getWeather())?.tempF).toBe(82);

    advance(16 * 60_000);
    fetchMock.mockResolvedValueOnce(rateLimited());
    expect((await getWeather())?.tempF).toBe(82);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry again until the Retry-After window has passed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await getWeather();

    advance(16 * 60_000);
    fetchMock.mockResolvedValueOnce(rateLimited());
    await getWeather();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Retry-After was 600s. A poll five minutes later must not hit the network...
    advance(5 * 60_000);
    await getWeather();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // ...but one after the window does.
    advance(6 * 60_000);
    fetchMock.mockResolvedValueOnce(okResponse());
    await getWeather();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up on the stale reading once it is older than six hours', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await getWeather();

    advance(7 * 60 * 60_000);
    fetchMock.mockResolvedValue(rateLimited());
    expect(await getWeather()).toBeNull();
  });

  it('returns null rather than throwing when the very first fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await getWeather()).toBeNull();
  });
});
