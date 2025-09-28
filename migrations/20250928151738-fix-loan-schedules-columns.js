/* eslint-disable */
"use strict";

/**
 * Safely ensure loan_schedules.due_date is present and NOT NULL.
 * Backfill priority:
 *   1) legacy "dueDate" (camel, quoted)
 *   2) created_at (snake)
 *   3) "createdAt" (camel, quoted)
 *   4) CURRENT_DATE fallback
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      // 1) Add due_date if missing (NULLable first)
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'loan_schedules'
              AND column_name  = 'due_date'
          ) THEN
            ALTER TABLE public.loan_schedules
              ADD COLUMN due_date DATE NULL;
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      // 2a) Backfill from legacy "dueDate" if that column exists
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'loan_schedules'
              AND column_name  = 'dueDate'  -- case-sensitive identifier
          ) THEN
            UPDATE public.loan_schedules
               SET due_date = COALESCE(due_date, "dueDate"::date)
             WHERE due_date IS NULL;
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      // 2b) Else backfill from created_at if that exists
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'loan_schedules'
              AND column_name  = 'created_at'
          ) THEN
            UPDATE public.loan_schedules
               SET due_date = COALESCE(due_date, created_at::date)
             WHERE due_date IS NULL;
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      // 2c) Else backfill from "createdAt" if that exists
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'loan_schedules'
              AND column_name  = 'createdAt'
          ) THEN
            UPDATE public.loan_schedules
               SET due_date = COALESCE(due_date, "createdAt"::date)
             WHERE due_date IS NULL;
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      // 2d) Final fallback: any remaining NULLs → today
      await queryInterface.sequelize.query(
        `
        UPDATE public.loan_schedules
           SET due_date = CURRENT_DATE
         WHERE due_date IS NULL;
        `,
        { transaction: t }
      );

      // 3) Enforce NOT NULL
      await queryInterface.sequelize.query(
        `ALTER TABLE public.loan_schedules ALTER COLUMN due_date SET NOT NULL;`,
        { transaction: t }
      );

      // 4) Optional: drop legacy camel "dueDate" to avoid confusion
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'loan_schedules'
              AND column_name  = 'dueDate'
          ) THEN
            ALTER TABLE public.loan_schedules DROP COLUMN "dueDate";
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      // 5) Optional helpful index
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename  = 'loan_schedules'
              AND indexname  = 'loan_schedules_due_date_idx'
          ) THEN
            CREATE INDEX loan_schedules_due_date_idx ON public.loan_schedules (due_date);
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      // Relax constraint and drop the index; keep the column to avoid data loss.
      await queryInterface.sequelize.query(
        `ALTER TABLE public.loan_schedules ALTER COLUMN due_date DROP NOT NULL;`,
        { transaction: t }
      );

      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename  = 'loan_schedules'
              AND indexname  = 'loan_schedules_due_date_idx'
          ) THEN
            DROP INDEX public.loan_schedules_due_date_idx;
          END IF;
        END $$;
        `,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
