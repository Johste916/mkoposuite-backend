'use strict';

/**
 * Preflight: normalize existing billing tables so later migrations don't fail.
 * - If billing_subscriptions exists, ensure plan_id exists
 *   (rename legacy "planId" -> plan_id or add column if missing).
 * - Also normalize createdAt/updatedAt -> created_at/updated_at across billing tables.
 */
module.exports = {
  up: async (queryInterface) => {
    const sql = (s) => queryInterface.sequelize.query(s);

    // Ensure table exists before touching it; then rename/add plan_id safely
    await sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='billing_subscriptions'
      ) THEN
        -- Rename legacy "planId" to plan_id when needed
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='planId'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='plan_id'
        ) THEN
          EXECUTE 'ALTER TABLE public.billing_subscriptions RENAME COLUMN "planId" TO plan_id';
        END IF;

        -- If still no plan_id, add it
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='plan_id'
        ) THEN
          EXECUTE 'ALTER TABLE public.billing_subscriptions ADD COLUMN plan_id uuid NULL';
        END IF;
      END IF;
    END$$;
    `);

    // Normalize createdAt/updatedAt across any existing billing tables
    await sql(`
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[
        'billing_plans',
        'billing_subscriptions',
        'billing_invoices',
        'billing_invoice_items',
        'billing_payments',
        'billing_entitlements'
      ]
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=t AND column_name='createdAt'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=t AND column_name='created_at'
        ) THEN
          EXECUTE format('ALTER TABLE public.%I RENAME COLUMN "createdAt" TO created_at', t);
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=t AND column_name='updatedAt'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=t AND column_name='updated_at'
        ) THEN
          EXECUTE format('ALTER TABLE public.%I RENAME COLUMN "updatedAt" TO updated_at', t);
        END IF;
      END LOOP;
    END$$;
    `);
  },

  down: async () => {
    // Intentionally a no-op (preflight normalization should not be undone).
  },
};
