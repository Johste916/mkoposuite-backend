"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // 0) Ensure table exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public.activity_assignments') IS NULL THEN
          CREATE TABLE public.activity_assignments (
            id           SERIAL PRIMARY KEY,
            "activityId" INTEGER NULL,
            "assigneeId" UUID NULL,
            "assignerId" UUID NULL,
            "dueDate"    TIMESTAMPTZ NULL,
            note         TEXT NULL,
            status       TEXT NOT NULL DEFAULT 'open',
            "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        END IF;
      END$$;
    `);

    // 1) Drop any pre-existing FKs that may have been partially created
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_activity') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_activity;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_assignee') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_assignee;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_assigner') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_assigner;
        END IF;
      END$$;
    `);

    // 2) Make sure assigneeId / assignerId are UUID (drop & re-add if needed)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        -- assigneeId
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='activity_assignments'
            AND column_name='assigneeId' AND data_type <> 'uuid'
        ) THEN
          ALTER TABLE public.activity_assignments DROP COLUMN "assigneeId";
          ALTER TABLE public.activity_assignments ADD COLUMN "assigneeId" UUID NULL;
        ELSIF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='activity_assignments'
            AND column_name='assigneeId'
        ) THEN
          ALTER TABLE public.activity_assignments ADD COLUMN "assigneeId" UUID NULL;
        END IF;

        -- assignerId
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='activity_assignments'
            AND column_name='assignerId' AND data_type <> 'uuid'
        ) THEN
          ALTER TABLE public.activity_assignments DROP COLUMN "assignerId";
          ALTER TABLE public.activity_assignments ADD COLUMN "assignerId" UUID NULL;
        ELSIF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='activity_assignments'
            AND column_name='assignerId'
        ) THEN
          ALTER TABLE public.activity_assignments ADD COLUMN "assignerId" UUID NULL;
        END IF;
      END$$;
    `);

    // 3) Ensure ENUM for status exists and convert column to it
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_activity_assignments_status') THEN
          CREATE TYPE enum_activity_assignments_status AS ENUM ('open','in-progress','completed','cancelled');
        END IF;
      END$$;
    `);

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='activity_assignments' AND column_name='status'
        ) THEN
          ALTER TABLE public.activity_assignments
          ALTER COLUMN status TYPE enum_activity_assignments_status
          USING status::enum_activity_assignments_status;
        END IF;
      END$$;
    `);

    // 4) Recreate FKs (only if referenced tables exist)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public.activity_logs') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.conname='fk_activity_assignments_activity' AND t.relname='activity_assignments'
           )
        THEN
          ALTER TABLE public.activity_assignments
          ADD CONSTRAINT fk_activity_assignments_activity
          FOREIGN KEY ("activityId")
          REFERENCES public.activity_logs(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE;
        END IF;
      END$$;
    `);

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public."Users"') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.conname='fk_activity_assignments_assignee' AND t.relname='activity_assignments'
           )
        THEN
          ALTER TABLE public.activity_assignments
          ADD CONSTRAINT fk_activity_assignments_assignee
          FOREIGN KEY ("assigneeId")
          REFERENCES public."Users"(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL;
        END IF;

        IF to_regclass('public."Users"') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.conname='fk_activity_assignments_assigner' AND t.relname='activity_assignments'
           )
        THEN
          ALTER TABLE public.activity_assignments
          ADD CONSTRAINT fk_activity_assignments_assigner
          FOREIGN KEY ("assignerId")
          REFERENCES public."Users"(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    // Just remove FKs and enum (keep table)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_activity') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_activity;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_assignee') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_assignee;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_activity_assignments_assigner') THEN
          ALTER TABLE public.activity_assignments DROP CONSTRAINT fk_activity_assignments_assigner;
        END IF;
      END$$;
    `);

    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS enum_activity_assignments_status;`);
  },
};
