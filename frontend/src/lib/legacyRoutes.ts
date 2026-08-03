// frontend/src/lib/legacyRoutes.ts
// Old flat view keys → new division-hub paths. Backend-emitted links
// (notifications link_view, daily-brief CTAs) and bookmarks predate the hub
// restructure, so these redirects are permanent, not transitional.
const LEGACY: Record<string, { to: string; keepsId: boolean }> = {
  'gen-leads':       { to: '/generators/leads',    keepsId: true },
  'pipeline':        { to: '/generators/pipeline', keepsId: true },
  'gen-proposals':   { to: '/generators/pipeline', keepsId: true },
  'elec-proposals':  { to: '/electrical/bids',     keepsId: true },
  'intake':          { to: '/electrical/intake',   keepsId: false },
  'gen-projects':    { to: '/generators/jobs',     keepsId: true },
  'elec-projects':   { to: '/electrical/projects', keepsId: true },
  'sales-dashboard': { to: '/dashboard',           keepsId: false },
  'reporting':       { to: '/dashboard',           keepsId: false },
  'preconstruction': { to: '/electrical/bids',     keepsId: false },
};

export function resolveLegacyPath(pathname: string): string | null {
  const segments = pathname.replace(/^\/+/, '').split('/');
  const entry = LEGACY[segments[0]];
  if (!entry) return null;
  const id = entry.keepsId && segments[1] ? '/' + segments[1] : '';
  return entry.to + id;
}
