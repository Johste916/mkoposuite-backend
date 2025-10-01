'use strict';

/**
 * Adds columns to "SavingsTransactions" only if they don't exist, to keep
 * inserts robust across environments.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface.sequelize;

    await qi.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='SavingsTransactions' AND column_name='notes'
        ) THEN
          ALTER TABLE public."SavingsTransactions" ADD COLUMN notes TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='SavingsTransactions' AND column_name='status'
        ) THEN
          ALTER TABLE public."SavingsTransactions" ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='SavingsTransactions' AND column_name='reversed'
        ) THEN
          ALTER TABLE public."SavingsTransactions" ADD COLUMN reversed BOOLEAN DEFAULT FALSE NOT NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface, Sequelize) {
    // Usually safe to leave these in place; if you need to drop them, uncomment:
    // await queryInterface.removeColumn('SavingsTransactions', 'notes');
    // await queryInterface.removeColumn('SavingsTransactions', 'status');
    // await queryInterface.removeColumn('SavingsTransactions', 'reversed');
  }
};
