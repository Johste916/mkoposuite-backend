'use strict';

/**
 * Ensures Roles has:
 *  - code: VARCHAR(64), unique, NOT NULL, backfilled from name with slug logic and de-duped.
 *  - slug: mirrors code.
 *      - Prefer GENERATED ALWAYS AS (code) STORED (PG 12+).
 *      - Fallback: normal column + trigger to keep slug in sync with code.
 *
 * Idempotent: checks existing columns/indexes before creating.
 */

async function indexExists(qi, indexName, transaction) {
  const [rows] = await qi.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :name`,
    { replacements: { name: indexName }, transaction }
  );
  return rows.length > 0;
}

module.exports = {
  async up(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      const table = await qi.describeTable('Roles');

      /* ----------------------------- 1) Ensure code ----------------------------- */
      if (!table.code) {
        await qi.addColumn(
          'Roles',
          'code',
          { type: Sequelize.STRING(64), allowNull: true }, // temp null until backfilled
          { transaction: t }
        );

        // Backfill `code` from `name` (slugify), with de-duplication (_1, _2, ...)
        await qi.sequelize.query(
          `
          WITH base AS (
            SELECT
              id,
              LOWER(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(name, '[^A-Za-z0-9\\s-]', '', 'g'),
                  '[\\s-]+',
                  '_',
                  'g'
                )
              ) AS raw
            FROM "public"."Roles"
          ),
          trimmed AS (
            SELECT
              id,
              REGEXP_REPLACE(
                REGEXP_REPLACE(raw, '^_+', '', 'g'),
                '_+$',
                '',
                'g'
              ) AS base
            FROM base
          ),
          numbered AS (
            SELECT
              id,
              base,
              ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS rn
            FROM trimmed
          ),
          resolved AS (
            SELECT
              id,
              CASE
                WHEN rn = 1 THEN COALESCE(NULLIF(base, ''), 'role_' || id::text)
                ELSE COALESCE(NULLIF(base, ''), 'role_' || id::text) || '_' || (rn - 1)::text
              END AS code
            FROM numbered
          )
          UPDATE "public"."Roles" AS r
          SET "code" = res.code
          FROM resolved res
          WHERE r.id = res.id
            AND r."code" IS NULL;
          `,
          { transaction: t }
        );

        // Unique index on code (create if missing)
        const codeIdx = 'roles_code_unique';
        if (!(await indexExists(qi, codeIdx, t))) {
          await qi.addIndex('Roles', ['code'], { unique: true, name: codeIdx, transaction: t });
        }

        // Enforce NOT NULL
        await qi.changeColumn(
          'Roles',
          'code',
          { type: Sequelize.STRING(64), allowNull: false },
          { transaction: t }
        );
      }

      /* -------------------------- 2) Ensure slug alias -------------------------- */
      const tableAfterCode = await qi.describeTable('Roles');

      if (!tableAfterCode.slug) {
        // Try generated column first (PG 12+)
        let generatedWorked = false;
        try {
          await qi.sequelize.query(
            `ALTER TABLE "public"."Roles" ADD COLUMN "slug" TEXT GENERATED ALWAYS AS ("code") STORED`,
            { transaction: t }
          );
          generatedWorked = true;
        } catch (e) {
          // Fall back to normal col + trigger
          await qi.addColumn(
            'Roles',
            'slug',
            { type: Sequelize.STRING(64), allowNull: true },
            { transaction: t }
          );

          await qi.sequelize.query(
            `UPDATE "public"."Roles" SET "slug" = "code" WHERE "slug" IS NULL;`,
            { transaction: t }
          );

          // Sync trigger: slug := code on insert/update
          await qi.sequelize.query(
            `
            CREATE OR REPLACE FUNCTION public.roles_sync_slug() RETURNS trigger AS $$
            BEGIN
              NEW.slug := NEW.code;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS roles_sync_slug_biu ON "public"."Roles";
            CREATE TRIGGER roles_sync_slug_biu
              BEFORE INSERT OR UPDATE ON "public"."Roles"
              FOR EACH ROW
              EXECUTE FUNCTION public.roles_sync_slug();
            `,
            { transaction: t }
          );

          await qi.changeColumn(
            'Roles',
            'slug',
            { type: Sequelize.STRING(64), allowNull: false },
            { transaction: t }
          );
        }

        // (Optional) Non-unique index on slug to speed lookups (not required)
        const slugIdx = 'roles_slug_idx';
        if (!(await indexExists(qi, slugIdx, t))) {
          await qi.addIndex('Roles', ['slug'], { name: slugIdx, transaction: t });
        }
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      // Remove slug index if present
      try {
        await qi.removeIndex('Roles', 'roles_slug_idx', { transaction: t });
      } catch (_) {}

      // Drop trigger + function if they exist (fallback path)
      try {
        await qi.sequelize.query(
          `
          DROP TRIGGER IF EXISTS roles_sync_slug_biu ON "public"."Roles";
          DROP FUNCTION IF EXISTS public.roles_sync_slug();
          `,
          { transaction: t }
        );
      } catch (_) {}

      // Drop slug column
      const table = await qi.describeTable('Roles');
      if (table.slug) {
        await qi.removeColumn('Roles', 'slug', { transaction: t });
      }

      // NOTE: We intentionally DO NOT remove `code` or its unique index in down(),
      // because other parts of your app may now rely on it.
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
