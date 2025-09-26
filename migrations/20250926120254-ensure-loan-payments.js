/* migrations/20250926_120500-ensure-loan-payments.js */
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Create table if missing
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.loan_payments (
        id            SERIAL PRIMARY KEY,
        "loanId"      INTEGER       NOT NULL,
        "userId"      UUID          NULL,
        "amountPaid"  NUMERIC(14,2) NOT NULL DEFAULT 0,
        "paymentDate" DATE          NOT NULL,
        method        TEXT          NULL,
        notes         TEXT          NULL,
        status        VARCHAR(16)   NOT NULL DEFAULT 'approved',
        applied       BOOLEAN       NOT NULL DEFAULT true,
        reference     TEXT          NULL,
        "receiptNo"   TEXT          NULL,
        currency      VARCHAR(8)    NULL,
        gateway       TEXT          NULL,
        "gatewayRef"  TEXT          NULL,
        allocation    JSONB         NULL DEFAULT '{}'::jsonb,
        "voidReason"  TEXT          NULL,
        "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // 2) Ensure all columns exist (idempotent)
    await queryInterface.sequelize.query(`
      ALTER TABLE public.loan_payments
        ADD COLUMN IF NOT EXISTS "loanId"      INTEGER,
        ADD COLUMN IF NOT EXISTS "userId"      UUID,
        ADD COLUMN IF NOT EXISTS "amountPaid"  NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "paymentDate" DATE NOT NULL,
        ADD COLUMN IF NOT EXISTS method        TEXT,
        ADD COLUMN IF NOT EXISTS notes         TEXT,
        ADD COLUMN IF NOT EXISTS status        VARCHAR(16) NOT NULL DEFAULT 'approved',
        ADD COLUMN IF NOT EXISTS applied       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS reference     TEXT,
        ADD COLUMN IF NOT EXISTS "receiptNo"   TEXT,
        ADD COLUMN IF NOT EXISTS currency      VARCHAR(8),
        ADD COLUMN IF NOT EXISTS gateway       TEXT,
        ADD COLUMN IF NOT EXISTS "gatewayRef"  TEXT,
        ADD COLUMN IF NOT EXISTS allocation    JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "voidReason"  TEXT,
        ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // 3) FK constraints where possible (skip if targets missing)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='loans')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='loan_payments_loan_fkey') THEN
          ALTER TABLE public.loan_payments
            ADD CONSTRAINT loan_payments_loan_fkey
            FOREIGN KEY ("loanId") REFERENCES public.loans(id)
            ON UPDATE CASCADE ON DELETE CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Users')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='loan_payments_user_fkey') THEN
          ALTER TABLE public.loan_payments
            ADD CONSTRAINT loan_payments_user_fkey
            FOREIGN KEY ("userId") REFERENCES public."Users"(id)
            ON UPDATE SET NULL ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // 4) Indexes
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS loan_payments_loan_idx         ON public.loan_payments("loanId");
      CREATE INDEX IF NOT EXISTS loan_payments_user_idx         ON public.loan_payments("userId");
      CREATE INDEX IF NOT EXISTS loan_payments_paymentDate_idx  ON public.loan_payments("paymentDate");
      CREATE INDEX IF NOT EXISTS loan_payments_status_idx       ON public.loan_payments(status);
      CREATE INDEX IF NOT EXISTS loan_payments_reference_idx    ON public.loan_payments(reference);
      CREATE INDEX IF NOT EXISTS loan_payments_gatewayRef_idx   ON public.loan_payments("gatewayRef");
      CREATE INDEX IF NOT EXISTS loan_payments_createdAt_idx    ON public.loan_payments("createdAt");
    `);
  },

  async down() {
    // Non-destructive ensure migration.
  },
};

module.exports.config = { transaction: false };
