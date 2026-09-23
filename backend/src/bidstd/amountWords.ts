// Takeoff accuracy Task 13 — the Cowork price line: "Total Electrical Scope —
// Eighty-One Thousand Four Hundred Eighty-Five and 60/100 Dollars   $81,485.60".
// Pure.

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion'];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`);
  return parts.join(' ');
}

/** Whole dollars in words ("Eighty-One Thousand Four Hundred Eighty-Five"). */
export function dollarsInWords(whole: number): string {
  if (!Number.isInteger(whole) || whole < 0 || whole >= 1e12) throw new Error(`amount out of range: ${whole}`);
  if (whole === 0) return 'Zero';
  const groups: string[] = [];
  let n = whole;
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) groups.unshift(`${under1000(g)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

/** Parse "$81,485.60" / "81485.6" / 81485.6 into integer cents; null if not a price. */
export function priceToCents(price: string | number): number | null {
  const s = typeof price === 'number' ? String(price) : price.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [d, c = ''] = s.split('.');
  return Number(d) * 100 + Number((c + '00').slice(0, 2));
}

/** "Eighty-One Thousand Four Hundred Eighty-Five and 60/100 Dollars". */
export function amountInWords(price: string | number): string | null {
  const cents = priceToCents(price);
  if (cents == null) return null;
  const whole = Math.floor(cents / 100);
  return `${dollarsInWords(whole)} and ${String(cents % 100).padStart(2, '0')}/100 Dollars`;
}

/** "$81,485.60" — always two decimals. */
export function formatPriceCents(price: string | number): string | null {
  const cents = priceToCents(price);
  if (cents == null) return null;
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}
