'use strict';

/**
 * This migration changes public.loan_schedules.paid to NUMERIC(14,2).
 * - If it's BOOLEAN: map TRUE -> full scheduled total, FALSE -> 0, then replace the column.
 * - If it's already NUMERIC: enforce NUMERIC(14,2) + NOT NULL + DEFAULT 0.
 * No application code changes required.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface.sequelize;

    // 1) Detect current data type of loan_schedules.paid
    const [{ data_type }] = await qi.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loan_schedules'
        AND column_name = 'paid'
    `, { type: Sequelize.QueryTypes.SELECT });

    // 2) If BOOLEAN -> create paid_tmp numeric, backfill, swap in
    if (String(data_type).toLowerCase() === 'boolean') {
      await qi.query(`
        ALTER TABLE public.loan_schedules
          ADD COLUMN paid_tmp NUMERIC(14,2) DEFAULT 0 NOT NULL;
      `);

      // Map TRUE -> principal+interest+fees+penalties (NULL-safe), FALSE -> 0
      await qi.query(`
        UPDATE public.loan_schedules ls
        SET paid_tmp =
          CASE
            WHEN ls.paid IS TRUE
              THEN COALESCE(ls.principal,0)
                 + COALESCE(ls.interest,0)
                 + COALESCE(ls.fees,0)
                 + COALESCE(ls.penalties,0)
            ELSE 0
          END;
      `);

      await qi.query(`ALTER TABLE public.loan_schedules DROP COLUMN paid;`);
      await qi.query(`ALTER TABLE public.loan_schedules RENAME COLUMN paid_tmp TO paid;`);

      // Safety: ensure constraints
      await qi.query(`
        ALTER TABLE public.loan_schedules
          ALTER COLUMN paid SET DEFAULT 0,
          ALTER COLUMN paid SET NOT NULL;
      `);
    } else {
      // 3) If already numeric, standardize to NUMERIC(14,2), NOT NULL, DEFAULT 0
      await qi.query(`
        ALTER TABLE public.loan_schedules
          ALTER COLUMN paid TYPE NUMERIC(14,2) USING paid::numeric,
          ALTER COLUMN paid SET DEFAULT 0,
          ALTER COLUMN paid SET NOT NULL;
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface.sequelize;

    // Revert to a boolean with a best-effort mapping:
    // TRUE if paid >= (principal+interest+fees+penalties) - 0.01, else FALSE
    await qi.query(`
      ALTER TABLE public.loan_schedules
        ADD COLUMN paid_bool BOOLEAN DEFAULT FALSE NOT NULL;
    `);

    await qi.query(`
      UPDATE public.loan_schedules ls
      SET paid_bool =
        (COALESCE(ls.paid,0) >=
         COALESCE(ls.principal,0)+COALESCE(ls.interest,0)+COALESCE(ls.fees,0)+COALESCE(ls.penalties,0) - 0.01);
    `);

    await qi.query(`ALTER TABLE public.loan_schedules DROP COLUMN paid;`);
    await qi.query(`ALTER TABLE public.loan_schedules RENAME COLUMN paid_bool TO paid;`);
  }
};
