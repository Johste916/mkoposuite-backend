'use strict';

/**
 * Adds a `code` column to Roles, backfills from `name` (slugified),
 * resolves duplicates by appending _1, _2, ... then enforces UNIQUE + NOT NULL.
 *
 * Safe for existing data. Uses a transaction for atomicity.
 */

module.exports = {
  async up(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      // 1) Add the column (nullable during backfill)
      const table = await qi.describeTable('Roles');
      if (!table.code) {
        await qi.addColumn(
          'Roles',
          'code',
          {
            type: Sequelize.STRING(64),
            allowNull: true, // temporary; set NOT NULL after backfill
          },
          { transaction: t }
        );
      }

      // 2) Backfill using a slug of `name`
      //
      // - keep letters/digits/spaces/dashes
      // - collapse spaces/dashes -> underscore
      // - lowercase
      // - trim leading/trailing underscores
      // - ensure not empty; fallback to "role_<id>"
      // - de-duplicate with _1, _2, ... suffixes if needed
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

      // 3) Add unique index
      await qi.addIndex(
        'Roles',
        ['code'],
        { unique: true, name: 'roles_code_unique', transaction: t }
      );

      // 4) Enforce NOT NULL
      await qi.changeColumn(
        'Roles',
        'code',
        { type: Sequelize.STRING(64), allowNull: false },
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      // Drop unique index first
      try {
        await qi.removeIndex('Roles', 'roles_code_unique', { transaction: t });
      } catch (_) {
        // ignore if it doesn't exist
      }

      // Then remove the column
      const table = await qi.describeTable('Roles');
      if (table.code) {
        await qi.removeColumn('Roles', 'code', { transaction: t });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
