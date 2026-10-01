// Fix round B5 — mirrors backend/src/ai/reviewItems.ts's isRealReason: a
// real explanation, not just enough characters (".........." fails).
// UI cleanup round 2A — lives here (not in LaborPricingStep) so the takeoff
// review panel can use it without importing the whole pricing step.
export function isRealReason(reason: string): boolean {
  return reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason);
}
