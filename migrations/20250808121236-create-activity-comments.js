// migrations/20250808121236-create-activity-comments.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Create table only if it doesn't exist
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public.activity_comments') IS NULL THEN
          CREATE TABLE public.activity_comments (
            id             SERIAL PRIMARY KEY,
            "activityLogId" INTEGER NULL,
            comment        TEXT NOT NULL,
            "createdBy"    UUID NULL,
            "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        END IF;
      END$$;
    `);

    // 2) Conditionally add FK -> activity_logs(id)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public.activity_logs') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.conname = 'fk_activity_comments_activity_log'
               AND t.relname = 'activity_comments'
           )
        THEN
          ALTER TABLE public.activity_comments
          ADD CONSTRAINT fk_activity_comments_activity_log
          FOREIGN KEY ("activityLogId")
          REFERENCES public.activity_logs(id)
          ON DELETE CASCADE
          ON UPDATE CASCADE;
        END IF;
      END$$;
    `);

    // 3) Conditionally add FK -> public."Users"(id) (note the case)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public."Users"') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.conname = 'fk_activity_comments_created_by'
               AND t.relname = 'activity_comments'
           )
        THEN
          ALTER TABLE public.activity_comments
          ADD CONSTRAINT fk_activity_comments_created_by
          FOREIGN KEY ("createdBy")
          REFERENCES public."Users"(id)
          ON DELETE SET NULL
          ON UPDATE CASCADE;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface /*, Sequelize */) {
    // Drop whole table safely (will also drop FKs)
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.activity_comments CASCADE;
    `);
  },
};
