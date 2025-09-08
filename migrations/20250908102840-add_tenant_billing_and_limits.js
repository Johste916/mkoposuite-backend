'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = `
      ALTER TABLE public.tenants
        ADD COLUMN IF NOT EXISTS plan_code text,
        ADD COLUMN IF NOT EXISTS trial_ends_at date,
        ADD COLUMN IF NOT EXISTS auto_disable_overdue boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 7,
        ADD COLUMN IF NOT EXISTS billing_email text,
        ADD COLUMN IF NOT EXISTS seats integer,
        ADD COLUMN IF NOT EXISTS staff_count integer;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='tenants' AND column_name='status'
        ) THEN
          ALTER TABLE public.tenants ADD COLUMN status text NOT NULL DEFAULT 'trial';
        END IF;
      END $$;
    `;
    await queryInterface.sequelize.query(sql);
  },

  async down(queryInterface, Sequelize) {
    const sql = `
      ALTER TABLE public.tenants
        DROP COLUMN IF EXISTS staff_count,
        DROP COLUMN IF EXISTS seats,
        DROP COLUMN IF EXISTS billing_email,
        DROP COLUMN IF EXISTS grace_days,
        DROP COLUMN IF EXISTS auto_disable_overdue,
        DROP COLUMN IF EXISTS trial_ends_at,
        DROP COLUMN IF EXISTS plan_code;
    `;
    await queryInterface.sequelize.query(sql);
  },
};
