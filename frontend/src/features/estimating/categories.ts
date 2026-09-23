// Mirrors backend/src/bidstd/boilerplate.ts's TAKEOFF_CATEGORIES exactly —
// the 8 standard takeoff categories, always in this order. Duplicated rather
// than imported because the frontend and backend are separate TypeScript
// projects; keep in sync if the backend list ever changes.
export const TAKEOFF_CATEGORIES = [
  'Service & Distribution',
  'Interior Lighting',
  'Exterior / Site Lighting',
  'Lighting Controls',
  'Branch Power',
  'Site / Underground / Allowances',
  'Low Voltage Infrastructure (Conduit & Boxes Only)',
  'Grounding',
] as const;
