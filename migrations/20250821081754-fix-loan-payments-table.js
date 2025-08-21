// migrations/20250821090200-fix-loan-payments-table.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) If a camel-cased table exists, rename it to snake_case
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'LoanPayments'
        ) THEN
          EXECUTE 'ALTER TABLE "LoanPayments" RENAME TO loan_payments';
        END IF;
      END
      $$;
    `);

    // 2) If loan_payments still doesn't exist, create it
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'loan_payments'
        ) THEN
          CREATE TABLE loan_payments (
            id           SERIAL PRIMARY KEY,
            "loanId"     INTEGER NOT NULL,
            "userId"     UUID NULL,
            "amountPaid" NUMERIC(14,2) NOT NULL DEFAULT 0,
            "paymentDate" DATE NOT NULL,
            method       TEXT NULL,
            notes        TEXT NULL,
            "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        END IF;
      END
      $$;
    `);

    // 3) Helpful indexes (idempotent)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments("loanId");
      CREATE INDEX IF NOT EXISTS idx_loan_payments_user_id ON loan_payments("userId");
      CREATE INDEX IF NOT EXISTS idx_loan_payments_payment_date ON loan_payments("paymentDate");
      CREATE INDEX IF NOT EXISTS idx_loan_payments_created_at ON loan_payments("createdAt");
    `);
  },

  async down(/* queryInterface, Sequelize */) {
    // No destructive down: we won't drop or rename back.
  },
};

// Some Postgres versions don't like DDL in transactions
module.exports.config = { transaction: false };
