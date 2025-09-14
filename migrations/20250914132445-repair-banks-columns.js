'use strict';

/**
 * Purpose: make existing `banks` table compatible with snake_case columns
 * used by the current Sequelize model. Safe to run multiple times.
 *
 * Strategy:
 * 1) Add missing snake_case columns (allowNull: true temporarily)
 * 2) Backfill from camelCase columns if they exist
 * 3) Apply NOT NULL/defaults where required
 * 4) Drop camelCase columns if present
 * 5) Ensure indexes exist
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'banks', schema: 'public' };

    // If table doesn't exist, do nothing (your create-banks migration will handle it)
    try {
      await queryInterface.describeTable(table);
    } catch {
      return;
    }

    const refresh = async () => queryInterface.describeTable(table);
    let desc = await refresh();

    const addIfMissingBackfillThenConstrain = async (snake, spec, camel) => {
      // 1) Add col if missing (initially allow null to permit backfill)
      if (!desc[snake]) {
        const tmpSpec = { ...spec, allowNull: true };
        await queryInterface.addColumn(table, snake, tmpSpec);
      }

      // 2) Backfill from camelCase if exists and snake_case has nulls
      desc = await refresh();
      const camelExists = !!desc[camel];
      if (camelExists) {
        // Copy values
        await queryInterface.sequelize.query(
          `UPDATE "public"."banks" SET "${snake}" = "${camel}" WHERE "${snake}" IS NULL;`
        );
      } else if (Object.prototype.hasOwnProperty.call(spec, 'defaultValue')) {
        // Fill defaults where still null
        const def = spec.defaultValue;
        const isString = typeof def === 'string';
        await queryInterface.sequelize.query(
          `UPDATE "public"."banks" SET "${snake}" = ${isString ? `'${def}'` : String(def)} WHERE "${snake}" IS NULL;`
        );
      }

      // 3) Apply NOT NULL if requested
      if (spec.allowNull === false) {
        await queryInterface.changeColumn(table, snake, spec);
      }

      desc = await refresh();

      // 4) Drop camelCase column if it still exists
      if (camelExists) {
        await queryInterface.removeColumn(table, camel);
      }
      desc = await refresh();
    };

    // Ensure all required columns exist in snake_case and are constrained correctly
    await addIfMissingBackfillThenConstrain('tenant_id',       { type: Sequelize.UUID,           allowNull: false }, 'tenantId');
    await addIfMissingBackfillThenConstrain('account_name',    { type: Sequelize.STRING(160),    allowNull: true  }, 'accountName');
    await addIfMissingBackfillThenConstrain('account_number',  { type: Sequelize.STRING(64),     allowNull: true  }, 'accountNumber');
    await addIfMissingBackfillThenConstrain('opening_balance', { type: Sequelize.DECIMAL(18,2),  allowNull: false, defaultValue: 0 }, 'openingBalance');
    await addIfMissingBackfillThenConstrain('current_balance', { type: Sequelize.DECIMAL(18,2),  allowNull: false, defaultValue: 0 }, 'currentBalance');
    await addIfMissingBackfillThenConstrain('is_active',       { type: Sequelize.BOOLEAN,        allowNull: false, defaultValue: true }, 'isActive');
    await addIfMissingBackfillThenConstrain('currency',        { type: Sequelize.STRING(8),      allowNull: false, defaultValue: 'TZS' }, 'currency');

    // createdAt/updatedAt can remain camelCase (common Sequelize style). If your DB already
    // has them as camelCase it's fine; your model timestamps are camelCase by default.

    // 5) Ensure indexes (idempotent via raw SQL)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'banks_tenant_id_idx') THEN
          CREATE INDEX banks_tenant_id_idx ON public.banks (tenant_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'banks_tenant_id_name_idx') THEN
          CREATE INDEX banks_tenant_id_name_idx ON public.banks (tenant_id, name);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'banks_tenant_id_account_number_idx') THEN
          CREATE INDEX banks_tenant_id_account_number_idx ON public.banks (tenant_id, account_number);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'banks_is_active_idx') THEN
          CREATE INDEX banks_is_active_idx ON public.banks (is_active);
        END IF;
      END$$;
    `);
  },

  async down() {
    // No-op: we don't want to revert to camelCase columns
  },
};
