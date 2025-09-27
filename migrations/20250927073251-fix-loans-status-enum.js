// src/migrations/20250927073251-fix-loans-status-enum.js
'use strict';

/**
 * Resets loans.status enum safely even if triggers depend on the column:
 *  1) Capture & DROP all non-internal triggers on public.loans
 *  2) DROP default; ALTER COLUMN status -> TEXT
 *  3) Clean/normalize values (null/empty/legacy -> 'pending')
 *  4) DROP lingering enum types (enum_loans_status_old, enum_loans_status)
 *  5) CREATE fresh enum type; ALTER COLUMN TEXT -> enum
 *  6) Restore NOT NULL + DEFAULT 'pending'
 *  7) Recreate previously captured triggers (same SQL as before)
 */

module.exports = {
  async up(queryInterface /* , Sequelize */) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    await sequelize.transaction(async (t) => {
      // --- 0) Capture all non-internal triggers on public.loans ---
      const [triggers] = await sequelize.query(
        `
        SELECT t.oid,
               t.tgname,
               pg_get_triggerdef(t.oid) AS def
        FROM pg_trigger t
        JOIN pg_class c       ON c.oid = t.tgrelid
        JOIN pg_namespace n   ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'loans'
          AND NOT t.tgisinternal
        ORDER BY t.tgname;
        `,
        { transaction: t }
      );

      // Drop those triggers for the duration of the type change
      for (const tr of triggers) {
        await sequelize.query(
          `DROP TRIGGER IF EXISTS "${tr.tgname}" ON "public"."loans";`,
          { transaction: t }
        );
      }

      // --- 1) Drop column default ('' or enum default may block) ---
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" DROP DEFAULT;
        `,
        { transaction: t }
      );

      // --- 2) Detach from any enum by casting to TEXT ---
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" TYPE TEXT
        USING ("status"::text);
        `,
        { transaction: t }
      );

      // --- 3) Normalize data before recreating enum ---
      await sequelize.query(
        `
        UPDATE "public"."loans"
           SET "status" = 'pending'
         WHERE "status" IS NULL OR btrim("status") = '';

        -- normalize case & legacy synonyms
        UPDATE "public"."loans" SET "status" = lower("status");
        UPDATE "public"."loans" SET "status" = 'disbursed' WHERE "status" = 'active';

        -- force unknowns to 'pending'
        UPDATE "public"."loans"
           SET "status" = 'pending'
         WHERE lower("status") NOT IN ('pending','approved','rejected','disbursed','closed');
        `,
        { transaction: t }
      );

      // --- 4) Drop any lingering enum types (now safe since column == TEXT) ---
      await sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_loans_status_old') THEN
            DROP TYPE "enum_loans_status_old";
          END IF;
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_loans_status') THEN
            DROP TYPE "enum_loans_status";
          END IF;
        END
        $$;
        `,
        { transaction: t }
      );

      // --- 5) Recreate clean enum and convert column back ---
      await sequelize.query(
        `
        CREATE TYPE "enum_loans_status" AS ENUM
          ('pending','approved','rejected','disbursed','closed');
        `,
        { transaction: t }
      );

      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" TYPE "enum_loans_status"
        USING ("status"::text::"enum_loans_status");
        `,
        { transaction: t }
      );

      // --- 6) Restore NOT NULL + DEFAULT 'pending' ---
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" SET NOT NULL,
        ALTER COLUMN "status" SET DEFAULT 'pending';
        `,
        { transaction: t }
      );

      // --- 7) Recreate previously dropped triggers exactly as before ---
      for (const tr of triggers) {
        // pg_get_triggerdef returns a full 'CREATE TRIGGER ...' statement
        if (tr.def && tr.def.trim().toUpperCase().startsWith('CREATE TRIGGER')) {
          await sequelize.query(tr.def, { transaction: t });
        }
      }
    });
  },

  async down(queryInterface /* , Sequelize */) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    await sequelize.transaction(async (t) => {
      // Capture and drop triggers again before type change
      const [triggers] = await sequelize.query(
        `
        SELECT t.oid,
               t.tgname,
               pg_get_triggerdef(t.oid) AS def
        FROM pg_trigger t
        JOIN pg_class c       ON c.oid = t.tgrelid
        JOIN pg_namespace n   ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'loans'
          AND NOT t.tgisinternal
        ORDER BY t.tgname;
        `,
        { transaction: t }
      );

      for (const tr of triggers) {
        await sequelize.query(
          `DROP TRIGGER IF EXISTS "${tr.tgname}" ON "public"."loans";`,
          { transaction: t }
        );
      }

      // Drop default first
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" DROP DEFAULT;
        `,
        { transaction: t }
      );

      // Convert back to TEXT
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" TYPE TEXT
        USING ("status"::text);
        `,
        { transaction: t }
      );

      // Allow NULLs (typical pre-enum state)
      await sequelize.query(
        `
        ALTER TABLE "public"."loans"
        ALTER COLUMN "status" DROP NOT NULL;
        `,
        { transaction: t }
      );

      // Drop enum (now unused)
      await sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_loans_status') THEN
            DROP TYPE "enum_loans_status";
          END IF;
        END
        $$;
        `,
        { transaction: t }
      );

      // Recreate triggers
      for (const tr of triggers) {
        if (tr.def && tr.def.trim().toUpperCase().startsWith('CREATE TRIGGER')) {
          await sequelize.query(tr.def, { transaction: t });
        }
      }
    });
  },
};
