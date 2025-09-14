'use strict';

/**
 * Repair banks schema to snake_case safely and idempotently.
 * - Adds snake_case columns if missing (no strict defaults on first add)
 * - Copies data from camelCase if present
 * - Tightens constraints (NOT NULL / defaults) after copy
 * - Drops camelCase columns if present
 * - Adds indexes with IF NOT EXISTS
 *
 * NOTE: We do NOT wrap everything in a single transaction, to prevent one
 * benign failure from aborting the whole migration on Postgres.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    const describe = async () =>
      qi.describeTable({ tableName: 'banks', schema: 'public' }).catch(() => ({}));

    // 1) Ensure snake_case columns exist (no NOT NULL yet)
    async function ensureColumn(col, def) {
      const desc = await describe();
      if (!desc[col]) {
        try {
          await qi.addColumn({ tableName: 'banks', schema: 'public' }, col, def);
        } catch (e) {
          // ignore "already exists" or concurrent add
          if (!/already exists|duplicate column/i.test(e.message)) throw e;
        }
      }
    }

    await ensureColumn('tenant_id',       { type: Sequelize.UUID, allowNull: true }); // allowNull for now
    await ensureColumn('account_name',    { type: Sequelize.STRING(160), allowNull: true });
    await ensureColumn('account_number',  { type: Sequelize.STRING(64),  allowNull: true });
    await ensureColumn('opening_balance', { type: Sequelize.DECIMAL(18,2), allowNull: true });
    await ensureColumn('current_balance', { type: Sequelize.DECIMAL(18,2), allowNull: true });
    await ensureColumn('is_active',       { type: Sequelize.BOOLEAN, allowNull: true });
    await ensureColumn('currency',        { type: Sequelize.STRING(8), allowNull: true });

    // 2) Copy values from camelCase -> snake_case (only where snake is NULL)
    async function copyIfBoth(camel, snake) {
      const desc = await describe();
      if (desc[camel] && desc[snake]) {
        const sql = `
          UPDATE "public"."banks"
          SET "${snake}" = COALESCE("${snake}", "public"."banks"."${camel}")
        `;
        await sequelize.query(sql);
      }
    }

    await copyIfBoth('tenantId',       'tenant_id');
    await copyIfBoth('accountName',    'account_name');
    await copyIfBoth('accountNumber',  'account_number');
    await copyIfBoth('openingBalance', 'opening_balance');
    await copyIfBoth('currentBalance', 'current_balance');
    await copyIfBoth('isActive',       'is_active');
    await copyIfBoth('currency',       'currency');

    // 3) Backfill sensible defaults where still NULL, then set NOT NULL where required
    // tenant_id: backfill to NIL uuid if still NULL
    await sequelize.query(`
      UPDATE "public"."banks"
      SET "tenant_id" = COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid)
    `);

    // numeric balances: default 0
    await sequelize.query(`
      UPDATE "public"."banks"
      SET "opening_balance" = COALESCE("opening_balance", 0),
          "current_balance" = COALESCE("current_balance", 0)
    `);

    // boolean is_active: default true
    await sequelize.query(`
      UPDATE "public"."banks"
      SET "is_active" = COALESCE("is_active", true)
    `);

    // currency: default 'TZS'
    await sequelize.query(`
      UPDATE "public"."banks"
      SET "currency" = COALESCE(NULLIF(TRIM(UPPER("currency")), ''), 'TZS')
    `);

    // Tighten constraints (ALTER COLUMN ... SET NOT NULL / SET DEFAULT)
    // Guard each ALTER with try/catch so a mismatch doesn't kill the rest
    async function alterSafe(sql) {
      try { await sequelize.query(sql); } catch (e) {
        // ignore common cases where it's already set
        if (!/already exists|does not exist|not-null|duplicate|invalid|cannot|relation .* does not exist/i.test(e.message)) {
          throw e;
        }
      }
    }

    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "tenant_id" SET NOT NULL`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "opening_balance" SET NOT NULL`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "current_balance" SET NOT NULL`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "is_active" SET NOT NULL`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "currency" SET NOT NULL`);

    // Set defaults (idempotent)
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "is_active" SET DEFAULT true`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "opening_balance" SET DEFAULT 0`);
    await alterSafe(`ALTER TABLE "public"."banks" ALTER COLUMN "current_balance" SET DEFAULT 0`);

    // 4) Drop camelCase columns if they still exist
    async function dropIfExists(col) {
      const desc = await describe();
      if (desc[col]) {
        try {
          await qi.removeColumn({ tableName: 'banks', schema: 'public' }, col);
        } catch (e) {
          if (!/does not exist/i.test(e.message)) throw e;
        }
      }
    }

    await dropIfExists('tenantId');
    await dropIfExists('accountName');
    await dropIfExists('accountNumber');
    await dropIfExists('openingBalance');
    await dropIfExists('currentBalance');
    await dropIfExists('isActive');

    // 5) Indexes with IF NOT EXISTS (raw SQL avoids name clashes)
    await alterSafe(`CREATE INDEX IF NOT EXISTS idx_banks_tenant_id            ON "public"."banks" ("tenant_id")`);
    await alterSafe(`CREATE INDEX IF NOT EXISTS idx_banks_tenant_id_name       ON "public"."banks" ("tenant_id","name")`);
    await alterSafe(`CREATE INDEX IF NOT EXISTS idx_banks_tenant_id_acctnum    ON "public"."banks" ("tenant_id","account_number")`);
    await alterSafe(`CREATE INDEX IF NOT EXISTS idx_banks_is_active            ON "public"."banks" ("is_active")`);
  },

  async down(queryInterface, Sequelize) {
    // Best-effort reverse (no data loss): re-create camelCase and copy back
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    const describe = async () =>
      qi.describeTable({ tableName: 'banks', schema: 'public' }).catch(() => ({}));

    async function ensureCamel(col, def) {
      const desc = await describe();
      if (!desc[col]) {
        try {
          await qi.addColumn({ tableName: 'banks', schema: 'public' }, col, def);
        } catch (e) {
          if (!/already exists|duplicate column/i.test(e.message)) throw e;
        }
      }
    }

    await ensureCamel('tenantId',       { type: Sequelize.UUID, allowNull: true });
    await ensureCamel('accountName',    { type: Sequelize.STRING(160), allowNull: true });
    await ensureCamel('accountNumber',  { type: Sequelize.STRING(64),  allowNull: true });
    await ensureCamel('openingBalance', { type: Sequelize.DECIMAL(18,2), allowNull: true });
    await ensureCamel('currentBalance', { type: Sequelize.DECIMAL(18,2), allowNull: true });
    await ensureCamel('isActive',       { type: Sequelize.BOOLEAN, allowNull: true });

    const desc = await describe();

    async function copyBack(snake, camel) {
      const d = await describe();
      if (d[snake] && d[camel]) {
        await sequelize.query(`
          UPDATE "public"."banks"
          SET "${camel}" = COALESCE("${camel}", "public"."banks"."${snake}")
        `);
      }
    }

    await copyBack('tenant_id',       'tenantId');
    await copyBack('account_name',    'accountName');
    await copyBack('account_number',  'accountNumber');
    await copyBack('opening_balance', 'openingBalance');
    await copyBack('current_balance', 'currentBalance');
    await copyBack('is_active',       'isActive');
  },
};
