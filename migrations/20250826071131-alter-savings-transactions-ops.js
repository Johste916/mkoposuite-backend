'use strict';

/**
 * Defensive, re-runnable migration:
 *  - No outer transaction (enum edits must be outside tx in Postgres).
 *  - Adds enum labels idempotently.
 *  - Ensures `reversed` exists.
 *  - Ensures `createdBy` matches Users.id type (uuid OR integer), drops/re-adds if wrong.
 *  - Safely (re)creates FK.
 */
module.exports = {
  useTransaction: false,

  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    /* -------------------- 1) Make sure enum has needed values -------------------- */
    const enumName = 'enum_SavingsTransactions_type';

    // add 'charge' if missing
    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = '${enumName}'
            AND e.enumlabel = 'charge'
        ) THEN
          ALTER TYPE "${enumName}" ADD VALUE 'charge';
        END IF;
      END$$;
    `);

    // add 'interest' if missing
    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = '${enumName}'
            AND e.enumlabel = 'interest'
        ) THEN
          ALTER TYPE "${enumName}" ADD VALUE 'interest';
        END IF;
      END$$;
    `);

    /* ----------------------- 2) Ensure `reversed` exists ------------------------- */
    await qi.sequelize.query(`
      ALTER TABLE "SavingsTransactions"
      ADD COLUMN IF NOT EXISTS "reversed" BOOLEAN DEFAULT false;
    `);

    /* -------- 3) Ensure `createdBy` column type matches Users.id type ------------ */

    // find Users.id type
    const typeRow = await qi.sequelize.query(
      `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Users'
          AND column_name = 'id'
        LIMIT 1;
      `,
      { type: qi.sequelize.QueryTypes.SELECT }
    );

    const isUUID =
      !!typeRow &&
      typeRow.length > 0 &&
      (
        (typeRow[0].data_type || '').toLowerCase() === 'uuid' ||
        (typeRow[0].udt_name   || '').toLowerCase() === 'uuid'
      );

    const createdByTypeDDL = isUUID ? 'UUID' : 'INTEGER';

    // drop FK if it exists (name we use below)
    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'SavingsTransactions'
            AND c.conname = 'fk_savings_tx_created_by'
        ) THEN
          ALTER TABLE "SavingsTransactions"
          DROP CONSTRAINT "fk_savings_tx_created_by";
        END IF;
      END$$;
    `);

    // if createdBy exists but wrong type, drop it; otherwise add if missing
    const desc = await qi.describeTable('SavingsTransactions');
    const hasCreatedBy = !!desc.createdBy;

    if (hasCreatedBy) {
      const colType = (desc.createdBy.type || '').toLowerCase();
      const wrongType =
        (isUUID && !colType.includes('uuid')) ||
        (!isUUID && !colType.includes('int'));

      if (wrongType) {
        // nuke the incorrect column (also removes any leftover constraint)
        await qi.sequelize.query(`
          ALTER TABLE "SavingsTransactions"
          DROP COLUMN "createdBy";
        `);
      }
    }

    // re-describe after potential drop
    const desc2 = await qi.describeTable('SavingsTransactions');
    if (!desc2.createdBy) {
      await qi.sequelize.query(`
        ALTER TABLE "SavingsTransactions"
        ADD COLUMN "createdBy" ${createdByTypeDDL} NULL;
      `);
    }

    // (re)attach FK safely if missing
    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'SavingsTransactions'
            AND c.conname = 'fk_savings_tx_created_by'
        ) THEN
          ALTER TABLE "SavingsTransactions"
          ADD CONSTRAINT "fk_savings_tx_created_by"
          FOREIGN KEY ("createdBy") REFERENCES "Users"("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface /*, Sequelize */) {
    // We can't remove enum labels in Postgres. Only clean columns/constraint.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'SavingsTransactions'
            AND c.conname = 'fk_savings_tx_created_by'
        ) THEN
          ALTER TABLE "SavingsTransactions"
          DROP CONSTRAINT "fk_savings_tx_created_by";
        END IF;
      END$$;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "SavingsTransactions"
      DROP COLUMN IF EXISTS "createdBy";
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "SavingsTransactions"
      DROP COLUMN IF EXISTS "reversed";
    `);
  },
};
