// Money rounding for proposal math.
//
// These figures used to round to whole dollars (Math.round), which silently ate the cents
// on every derived amount: 7% tax on $675.50 stored as $47, not $47.29, and the proposal
// then printed "$47.00" because the number really had no cents in it. Contract amounts are
// NUMERIC(12,2) in the database, so cents were always meant to survive.
//
// Rounding to the cent (rather than not rounding at all) also clears binary
// floating-point dust — 0.1 + 0.2 style — before an amount reaches the customer.

/** Rounds an amount to whole cents. */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Rounds the half-cent away from zero, so a credit and a charge of the same size round
  // to the same magnitude rather than drifting apart by a cent.
  const scaled = n * 100;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / 100;
}
