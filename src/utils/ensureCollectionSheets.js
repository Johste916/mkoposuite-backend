'use strict';

// Ensures public.collection_sheets exists in *this* DB connection.
// Idempotent: safe to run multiple times; avoids FK timing issues.
module.exports = async function ensureCollectionSheets(sequelize) {
  const q = (sql, opts = {}) => sequelize.query(sql, opts);

  // Which DB are we connected to?
  try {
    const [[meta]] = await q(`SELECT current_database() AS db, current_user AS usr, current_setting('search_path') AS search_path;`);
    console.log('🔌 DB connection =>', meta);
  } catch {
    /* non-fatal */
  }

  // Already there?
  const [[exists]] = await q(`SELECT to_regclass('public.collection_sheets') AS t;`);
  if (exists?.t) {
    console.log('✅ collection_sheets already exists:', exists.t);
    return;
  }

  // Figure out FK scalar types (INTEGER/UUID/BIGINT) if those tables exist.
  const fkTypeOf = async (table) => {
    try {
      const [rows] = await q(`
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='${table}' AND column_name='id'
        LIMIT 1;
      `);
      if (!rows?.length) return 'INTEGER';
      const { data_type, udt_name } = rows[0];
      const s = String(udt_name || data_type || '').toLowerCase();
      if (s.includes('uuid')) return 'UUID';
      if (s.includes('int8') || s.includes('bigint')) return 'BIGINT';
      return 'INTEGER';
    } catch { return 'INTEGER'; }
  };

  const [[b]] = await q(`SELECT to_regclass('public.branches') AS t;`);
  const [[u]] = await q(`SELECT to_regclass('public.users') AS t;`);
  const branchFkType = b?.t ? await fkTypeOf('branches') : 'INTEGER';
  const userFkType   = u?.t ? await fkTypeOf('users')    : 'INTEGER';

  // Ensure enum exists
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_collection_sheets_status') THEN
        CREATE TYPE enum_collection_sheets_status AS ENUM ('pending','completed','cancelled');
      END IF;
    END$$;
  `);

  // Create table (no FK constraints; we just align scalar types to avoid mismatches)
  const sql = `
    CREATE TABLE IF NOT EXISTS public.collection_sheets (
      id UUID PRIMARY KEY,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      collector TEXT NULL,
      loanOfficer TEXT NULL,
      status enum_collection_sheets_status NOT NULL DEFAULT 'pending',
      branchId ${branchFkType} NULL,
      collectorId ${userFkType} NULL,
      loanOfficerId ${userFkType} NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
      updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
    );`;
  await q(sql);

  // Indexes
  await q(`CREATE INDEX IF NOT EXISTS idx_collection_sheets_date   ON public.collection_sheets (date);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_collection_sheets_status ON public.collection_sheets (status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_collection_sheets_type   ON public.collection_sheets (type);`);

  console.log('✅ collection_sheets table ensured.');
};
