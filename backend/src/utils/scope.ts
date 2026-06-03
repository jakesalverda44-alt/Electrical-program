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
