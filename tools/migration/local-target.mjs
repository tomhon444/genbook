const approved = new WeakMap();
const configOf = db => db.connection?.config ?? db.config;

// A database name alone never authorizes a migration. Only the bootstrap that
// verifies its private instance receipt may bind a connection to this target.
export async function approveLocalGenbookTarget(db, instanceId) {
  const config = configOf(db);
  if (process.env.NODE_ENV === 'production' || !/^[a-f0-9-]{36}$/.test(instanceId ?? '') ||
      !config || config.host !== '127.0.0.1' || Number(config.port) !== 3306) throw new Error('Unapproved local migration target');
  const [[target]] = await db.query('SELECT DATABASE() name, @@port port');
  if (target.name !== 'genbook_db' || Number(target.port) !== 3306) throw new Error('Unapproved local migration target');
  const [[marker]] = await db.query('SELECT instance_uuid FROM migration_instance WHERE id=1');
  if (marker?.instance_uuid !== instanceId) throw new Error('Local migration instance mismatch');
  approved.set(db, instanceId);
}

export async function isApprovedLocalGenbookTarget(db) {
  const instanceId = approved.get(db);
  if (!instanceId || process.env.NODE_ENV === 'production') return false;
  const config = configOf(db);
  if (config?.host !== '127.0.0.1' || Number(config.port) !== 3306) return false;
  const [[target]] = await db.query('SELECT DATABASE() name, @@port port');
  if (target.name !== 'genbook_db' || Number(target.port) !== 3306) return false;
  const [[marker]] = await db.query('SELECT instance_uuid FROM migration_instance WHERE id=1');
  return marker?.instance_uuid === instanceId;
}
