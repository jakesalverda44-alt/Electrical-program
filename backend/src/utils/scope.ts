// Data-visibility scoping. "Managers see all, reps see own":
// salespeople are limited to records they own (their salesperson_id); every other role
// (owner, administrator, sales_manager, estimator, project_manager, accounting,
// technician, read_only, …) keeps full cross-deal visibility.
const RESTRICTED_ROLES = new Set(['salesperson', 'salesperson_legacy']);

/**
 * Returns the salesperson_id a user is restricted to, or null if the user may see all records.
 * Use the result to scope list/detail/mutation queries.
 */
export function ownScopeId(user: { id: string; role: string }): string | null {
  return RESTRICTED_ROLES.has(user.role) ? user.id : null;
}

// Multi-tenancy foundation. Every tenant-scoped table carries an org_id that
// backfills to this sentinel "default organization" (see migration 043). The
// system runs single-tenant today; legacy JWTs minted before the org claim, and
// any code path lacking an explicit org, resolve here so behavior is unchanged.
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * The organization a request is scoped to. Use this when adding tenant filtering
 * to a query (e.g. `WHERE org_id = $N`). Falls back to the default org for tokens
 * issued before org_id was part of the JWT payload.
 */
export function orgScope(user: { org_id?: string } | undefined): string {
  return user?.org_id ?? DEFAULT_ORG_ID;
}
