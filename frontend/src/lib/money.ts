// Single source of truth for money formatting across the app.
//
// Previously every page hand-rolled its own `'$' + n.toLocaleString()` helper,
// hard-coding the dollar sign and the en-US locale. These helpers route all of
// that through Intl.NumberFormat so the active currency (an app setting) is
// respected everywhere. `setCurrency` is called once when settings load.

let currencyCode = 'USD';

/** Set the active ISO-4217 currency code (e.g. 'USD', 'EUR'). No-op if blank. */
export function setCurrency(code: string | undefined | null): void {
  if (code && code.trim()) currencyCode = code.trim().toUpperCase();
}

export function getCurrencyCode(): string {
  return currencyCode;
}

function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, ...opts });
  } catch {
    // Bad/unknown code — fall back to USD so the UI never throws.
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', ...opts });
  }
}

/** Full amount, no cents: $1,234. */
export function moneyFull(n: number | null | undefined): string {
  return nf({ maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

/** Compact amount for tight UI: $1.23M, $1.2K, $123. */
export function moneyShort(n: number | null | undefined): string {
  const v = n || 0;
  if (Math.abs(v) >= 1000) {
    return nf({ notation: 'compact', maximumFractionDigits: Math.abs(v) >= 1_000_000 ? 2 : 1 }).format(v);
  }
  return nf({ maximumFractionDigits: 0 }).format(Math.round(v));
}

/** The currency symbol alone (e.g. '$', '€') — for input adornments. */
export function currencySymbol(): string {
  const part = nf({ maximumFractionDigits: 0 }).formatToParts(0).find(p => p.type === 'currency');
  return part ? part.value : '$';
}
