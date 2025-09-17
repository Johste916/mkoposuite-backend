'use strict';

/**
 * One-shot umbrella migration to ensure:
 *  - public.branches (table)
 *  - public.borrower_branches (table)
 *  - "public"."Borrowers".branch_id (column, index, FK)
 * Idempotent: only creates/adds what’s missing. Safe to run multiple times.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    const inTx = async (fn) => sequelize.transaction(async (t) => fn(t));

    // Helpers
    const tableExists = async (table, t) => {
      try {
        await qi.describeTable(table, { transaction: t });
        return true;
      } catch (err) {
        // Sequelize throws if table doesn't exist
        return false;
      }
    };

    const columnExists = async (table, col, t) => {
      try {
        const desc = await qi.describeTable(table, { transaction: t });
        return !!desc[col];
      } catch {
        return false;
      }
    };

    const ensureTable = async (tableRef, definition, options, t) => {
      const exists = await tableExists(tableRef, t);
      if (!exists) {
        await qi.createTable(tableRef, definition, { ...options, transaction: t });
      }
    };

    const ensureColumn = async (tableRef, col, def, t) => {
      const exists = await columnExists(tableRef, col, t);
      if (!exists) {
        await qi.addColumn(tableRef, col, def, { transaction: t });
      }
    };

    await inTx(async (t) => {
      // 1) Ensure public.branches
      await ensureTable(
        { tableName: 'branches', schema: 'public' },
        {
          id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: Sequelize.STRING, allowNull: false },
          code: { type: Sequelize.STRING, allowNull: true },
          phone: { type: Sequelize.TEXT, allowNull: true },
          address: { type: Sequelize.TEXT, allowNull: true },
          manager: { type: Sequelize.STRING, allowNull: true },
          tenant_id: { type: Sequelize.BIGINT, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          deletedAt: { type: Sequelize.DATE, allowNull: true },
        },
        {
          // paranoid via deletedAt column; underscored handled at model layer
        },
        t
      );

      // 2) Ensure public.borrower_branches (pivot)
      await ensureTable(
        { tableName: 'borrower_branches', schema: 'public' },
        {
          id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
          borrower_id: { type: Sequelize.INTEGER, allowNull: false },
          branch_id: { type: Sequelize.INTEGER, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        {},
        t
      );

      // Add FKs to pivot if they’re not there yet (best-effort)
      // (We try; if they already exist, we ignore errors.)
      await sequelize.query(
        `
        DO $$
        BEGIN
          -- borrower_id → "Borrowers"(id)
          BEGIN
            ALTER TABLE public.borrower_branches
              ADD CONSTRAINT borrower_branches_borrower_id_fkey
              FOREIGN KEY (borrower_id)
              REFERENCES "public"."Borrowers"(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          EXCEPTION WHEN duplicate_object THEN
            -- already exists
            NULL;
          END;

          -- branch_id → public.branches(id)
          BEGIN
            ALTER TABLE public.borrower_branches
              ADD CONSTRAINT borrower_branches_branch_id_fkey
              FOREIGN KEY (branch_id)
              REFERENCES public.branches(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          EXCEPTION WHEN duplicate_object THEN
            -- already exists
            NULL;
          END;

          -- helpful unique pair to prevent duplicates (optional)
          BEGIN
            CREATE UNIQUE INDEX borrower_branches_unique_pair
              ON public.borrower_branches (borrower_id, branch_id);
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END
        $$;
        `,
        { transaction: t }
      );

      // 3) Ensure "Borrowers".branch_id + index + FK → public.branches(id)
      const borrowersRef = { tableName: 'Borrowers', schema: 'public' };
      const hasBorrowers = await tableExists(borrowersRef, t);
      if (!hasBorrowers) {
        // Your DB already has "Borrowers" table, but guard just in case
        throw new Error(`Expected table "public"."Borrowers" to exist.`);
      }

      await ensureColumn(
        borrowersRef,
        'branch_id',
        { type: Sequelize.INTEGER, allowNull: true }, // keep nullable to avoid breaking inserts
        t
      );

      // Index (ignore if exists)
      await sequelize.query(
        `
        DO $$
        BEGIN
          BEGIN
            CREATE INDEX "Borrowers_branch_id_idx" ON "public"."Borrowers"(branch_id);
          EXCEPTION WHEN duplicate_table OR duplicate_object THEN
            NULL;
          END;
        END
        $$;
        `,
        { transaction: t }
      );

      // FK (ignore if exists)
      await sequelize.query(
        `
        DO $$
        BEGIN
          BEGIN
            ALTER TABLE "public"."Borrowers"
              ADD CONSTRAINT "Borrowers_branch_id_fkey"
              FOREIGN KEY (branch_id)
              REFERENCES public.branches(id)
              ON UPDATE CASCADE
              ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END
        $$;
        `,
        { transaction: t }
      );

      // 4) Optional backfill from borrower_branches if available
      await sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='borrower_branches'
          ) THEN
            UPDATE "public"."Borrowers" b
            SET branch_id = bb.branch_id
            FROM public.borrower_branches bb
            WHERE bb.borrower_id = b.id
              AND b.branch_id IS NULL;
          END IF;
        END
        $$;
        `,
        { transaction: t }
      );
    });
  },

  // Intentionally conservative: we avoid dropping anything automatically.
  async down(/* queryInterface, Sequelize */) {
    // No-op to prevent accidental data loss.
    // If you ever need to revert, create a dedicated down migration.
  },
};
