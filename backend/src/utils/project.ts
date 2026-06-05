import { logger } from './logger';

type Queryable = { query: (text: string, values?: unknown[]) => Promise<unknown> };

interface ProjectSeed {
  id: string;                       // = source bid/gen id (projects are 1:1 with their source)
  sourceType: 'elec' | 'gen';
  customerId?: string | null;
  name?: string | null;
  contractValue?: number | null;
  awardedAt?: string | Date | null;
}

/**
 * Create (or refresh) the project registry row for a newly awarded bid/gen.
 * The project shares the source's id, so child records (change orders, RFIs,
 * field notes, sections) attach to it directly. Safe to call repeatedly.
 * Pass the transaction client when called inside an award transaction.
 */
export async function ensureProject(db: Queryable, p: ProjectSeed): Promise<void> {
  await db.query(
    `INSERT INTO projects (id, source_type, customer_id, name, contract_value, awarded_at, status, deleted_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, now()),'active',NULL)
     ON CONFLICT (id) DO UPDATE
       SET customer_id    = EXCLUDED.customer_id,
           name           = EXCLUDED.name,
           contract_value = EXCLUDED.contract_value,
           awarded_at     = COALESCE(projects.awarded_at, EXCLUDED.awarded_at),
           deleted_at     = NULL,
           updated_at     = now()`,
    [p.id, p.sourceType, p.customerId ?? null, p.name ?? null, p.contractValue ?? null, p.awardedAt ?? null]
  );
}

/** Mirror a soft-delete / restore from a bid/gen onto its project row. */
export async function setProjectDeleted(db: Queryable, id: string, deleted: boolean): Promise<void> {
  try {
    await db.query(
      `UPDATE projects SET deleted_at = ${deleted ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`,
      [id]
    );
  } catch (err) {
    logger.error({ err, id, deleted }, 'Failed to sync project deleted_at');
  }
}
