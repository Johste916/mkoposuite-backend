'use strict';

/**
 * Robust billing bootstrap (Postgres)
 * - Works on fresh DBs and on partially-created older tables.
 * - Normalizes columns to snake_case (renames legacy camelCase if present).
 * - Adds missing columns with IF NOT EXISTS (including billing_plans!*).
 * - Safely wires FKs only after columns exist.
 * - Adds updated_at auto-touch trigger.
 * - Seeds example plans.
 */

module.exports = {
  up: async (queryInterface /*, Sequelize */) => {
    const sql = queryInterface.sequelize.query.bind(queryInterface.sequelize);

    /* 1) Extensions */
    await sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await sql(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    /* 2) Enums (idempotent) */
    await sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval') THEN
        CREATE TYPE billing_interval AS ENUM ('month','year');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_subscription_status') THEN
        CREATE TYPE billing_subscription_status AS ENUM ('trial','active','past_due','canceled');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_invoice_status') THEN
        CREATE TYPE billing_invoice_status AS ENUM ('draft','open','paid','void','uncollectible','refunded');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_payment_status') THEN
        CREATE TYPE billing_payment_status AS ENUM ('pending','succeeded','failed','refunded');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_entitlement_source') THEN
        CREATE TYPE billing_entitlement_source AS ENUM ('system','plan','subscription','manual');
      END IF;
    END$$;`);

    /* 3) Create tables if they don't exist (snake_case) */
    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_plans (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code          varchar(50)  NOT NULL UNIQUE,
        name          varchar(120) NOT NULL,
        description   text         NOT NULL DEFAULT '',
        price_cents   integer      NOT NULL DEFAULT 0,
        currency      varchar(3)   NOT NULL DEFAULT 'USD',
        "interval"    billing_interval NOT NULL DEFAULT 'month'::billing_interval,
        features      jsonb        NOT NULL DEFAULT '{}'::jsonb,
        is_active     boolean      NOT NULL DEFAULT true,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_plans_active_idx ON public.billing_plans (is_active);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_plans_code_idx   ON public.billing_plans (code);`);

    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid         NULL,
        plan_id       uuid         NULL,
        status        billing_subscription_status NOT NULL DEFAULT 'trial',
        seats         integer      NULL,
        provider      varchar(40)  NULL,
        external_id   varchar(120) NULL,
        trial_ends_at timestamptz  NULL,
        renews_at     timestamptz  NULL,
        meta          jsonb        NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_subs_tenant_idx   ON public.billing_subscriptions (tenant_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_subs_plan_idx     ON public.billing_subscriptions (plan_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_subs_status_idx   ON public.billing_subscriptions (status);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_subs_provider_idx ON public.billing_subscriptions (provider, external_id);`);

    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_invoices (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid         NULL,
        subscription_id  uuid         NULL,
        number           varchar(40)  NOT NULL UNIQUE,
        period_start     date         NULL,
        period_end       date         NULL,
        amount_cents     integer      NOT NULL DEFAULT 0,
        currency         varchar(3)   NOT NULL DEFAULT 'USD',
        status           billing_invoice_status NOT NULL DEFAULT 'draft',
        issued_at        timestamptz  NULL,
        due_at           timestamptz  NULL,
        paid_at          timestamptz  NULL,
        pdf_url          text         NULL,
        meta             jsonb        NOT NULL DEFAULT '{}'::jsonb,
        created_at       timestamptz  NOT NULL DEFAULT now(),
        updated_at       timestamptz  NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_invoices_tenant_idx ON public.billing_invoices (tenant_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_invoices_sub_idx    ON public.billing_invoices (subscription_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON public.billing_invoices (status);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_invoices_issued_idx ON public.billing_invoices (issued_at);`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_number_uniq ON public.billing_invoices (number);`);

    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_invoice_items (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id         uuid         NOT NULL,
        description        text         NOT NULL DEFAULT '',
        quantity           integer      NOT NULL DEFAULT 1,
        unit_amount_cents  integer      NOT NULL DEFAULT 0,
        amount_cents       integer      NOT NULL DEFAULT 0,
        product_code       varchar(80)  NULL,
        meta               jsonb        NOT NULL DEFAULT '{}'::jsonb,
        created_at         timestamptz  NOT NULL DEFAULT now(),
        updated_at         timestamptz  NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_invoice_items_invoice_idx ON public.billing_invoice_items (invoice_id);`);

    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_payments (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id    uuid         NULL,
        amount_cents  integer      NOT NULL DEFAULT 0,
        currency      varchar(3)   NOT NULL DEFAULT 'USD',
        method        varchar(40)  NULL,
        provider      varchar(40)  NULL,
        external_id   varchar(120) NULL,
        status        billing_payment_status NOT NULL DEFAULT 'pending',
        paid_at       timestamptz  NULL,
        meta          jsonb        NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_payments_invoice_idx ON public.billing_payments (invoice_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS billing_payments_status_idx  ON public.billing_payments (status);`);

    await sql(`
      CREATE TABLE IF NOT EXISTS public.billing_entitlements (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid         NOT NULL,
        key         varchar(120) NOT NULL,
        value       jsonb        NOT NULL DEFAULT '{}'::jsonb,
        source      billing_entitlement_source NOT NULL DEFAULT 'system',
        created_at  timestamptz  NOT NULL DEFAULT now(),
        updated_at  timestamptz  NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, key)
      );
    `);
    await sql(`CREATE INDEX IF NOT EXISTS billing_entitlements_tenant_idx ON public.billing_entitlements (tenant_id);`);

    /* 4) Normalize legacy camelCase → snake_case (incl. billing_plans) */
    await sql(`
    DO $$
    DECLARE
      _tbl text;
    BEGIN
      -- plans legacy → snake_case
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_plans' AND column_name='priceCents')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_plans' AND column_name='price_cents')
      THEN
        EXECUTE 'ALTER TABLE public.billing_plans RENAME COLUMN "priceCents" TO price_cents';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_plans' AND column_name='isActive')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_plans' AND column_name='is_active')
      THEN
        EXECUTE 'ALTER TABLE public.billing_plans RENAME COLUMN "isActive" TO is_active';
      END IF;

      -- subscriptions legacy → snake_case
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='tenantId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='tenant_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_subscriptions RENAME COLUMN "tenantId" TO tenant_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='externalId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='external_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_subscriptions RENAME COLUMN "externalId" TO external_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='trialEndsAt')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='trial_ends_at')
      THEN
        EXECUTE 'ALTER TABLE public.billing_subscriptions RENAME COLUMN "trialEndsAt" TO trial_ends_at';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='renewsAt')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions' AND column_name='renews_at')
      THEN
        EXECUTE 'ALTER TABLE public.billing_subscriptions RENAME COLUMN "renewsAt" TO renews_at';
      END IF;

      -- invoices camelCase → snake_case
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='subscriptionId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='subscription_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoices RENAME COLUMN "subscriptionId" TO subscription_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='tenantId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='tenant_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoices RENAME COLUMN "tenantId" TO tenant_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='pdfUrl')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='pdf_url')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoices RENAME COLUMN "pdfUrl" TO pdf_url';
      END IF;

      -- invoice_items camelCase → snake_case
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='invoiceId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='invoice_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoice_items RENAME COLUMN "invoiceId" TO invoice_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='unitAmountCents')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='unit_amount_cents')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoice_items RENAME COLUMN "unitAmountCents" TO unit_amount_cents';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='amountCents')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoice_items' AND column_name='amount_cents')
      THEN
        EXECUTE 'ALTER TABLE public.billing_invoice_items RENAME COLUMN "amountCents" TO amount_cents';
      END IF;

      -- payments camelCase → snake_case
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='invoiceId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='invoice_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_payments RENAME COLUMN "invoiceId" TO invoice_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='externalId')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='external_id')
      THEN
        EXECUTE 'ALTER TABLE public.billing_payments RENAME COLUMN "externalId" TO external_id';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='paidAt')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_payments' AND column_name='paid_at')
      THEN
        EXECUTE 'ALTER TABLE public.billing_payments RENAME COLUMN "paidAt" TO paid_at';
      END IF;

      -- universal timestamps (fixed loop using FOREACH)
      FOREACH _tbl IN ARRAY ARRAY[
        'billing_plans','billing_subscriptions','billing_invoices',
        'billing_invoice_items','billing_payments','billing_entitlements'
      ]
      LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=_tbl AND column_name='createdAt')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=_tbl AND column_name='created_at') THEN
          EXECUTE format('ALTER TABLE public.%I RENAME COLUMN "createdAt" TO created_at', _tbl);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=_tbl AND column_name='updatedAt')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=_tbl AND column_name='updated_at') THEN
          EXECUTE format('ALTER TABLE public.%I RENAME COLUMN "updatedAt" TO updated_at', _tbl);
        END IF;
      END LOOP;
    END$$;`);

    /* 5) Ensure required columns exist (covers legacy installs) */
    // billing_plans
    await sql(`ALTER TABLE public.billing_plans
      ADD COLUMN IF NOT EXISTS code varchar(50),
      ADD COLUMN IF NOT EXISTS name varchar(120),
      ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS "interval" billing_interval NOT NULL DEFAULT 'month'::billing_interval,
      ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);
    await sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='billing_plans_code_uniq'
      ) THEN
        CREATE UNIQUE INDEX billing_plans_code_uniq ON public.billing_plans (code);
      END IF;
    END$$;`);

    // subscriptions
    await sql(`ALTER TABLE public.billing_subscriptions
      ADD COLUMN IF NOT EXISTS plan_id uuid NULL,
      ADD COLUMN IF NOT EXISTS tenant_id uuid NULL,
      ADD COLUMN IF NOT EXISTS status billing_subscription_status NOT NULL DEFAULT 'trial',
      ADD COLUMN IF NOT EXISTS seats integer NULL,
      ADD COLUMN IF NOT EXISTS provider varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS external_id varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS renews_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // invoices
    await sql(`ALTER TABLE public.billing_invoices
      ADD COLUMN IF NOT EXISTS tenant_id uuid NULL,
      ADD COLUMN IF NOT EXISTS subscription_id uuid NULL,
      ADD COLUMN IF NOT EXISTS number varchar(40) NOT NULL,
      ADD COLUMN IF NOT EXISTS period_start date NULL,
      ADD COLUMN IF NOT EXISTS period_end date NULL,
      ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS status billing_invoice_status NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS issued_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS due_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS paid_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS pdf_url text NULL,
      ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // invoice_items
    await sql(`ALTER TABLE public.billing_invoice_items
      ADD COLUMN IF NOT EXISTS invoice_id uuid NOT NULL,
      ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS unit_amount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS product_code varchar(80) NULL,
      ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // payments
    await sql(`ALTER TABLE public.billing_payments
      ADD COLUMN IF NOT EXISTS invoice_id uuid NULL,
      ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS method varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS provider varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS external_id varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS status billing_payment_status NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS paid_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // entitlements
    await sql(`ALTER TABLE public.billing_entitlements
      ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL,
      ADD COLUMN IF NOT EXISTS key varchar(120) NOT NULL,
      ADD COLUMN IF NOT EXISTS value jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS source billing_entitlement_source NOT NULL DEFAULT 'system',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // If "interval" existed as text/varchar, coerce it to enum safely
    await sql(`
/* 5.5) Ensure UUID DEFAULT on id columns for legacy tables (prevents NULL id on insert) */
/* 5.6) Ensure created_at / updated_at have defaults + backfill */
DO $$
DECLARE
  t text;
  col text;
  has_default boolean;
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
    FOR col IN SELECT unnest(ARRAY['created_at','updated_at'])
    LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=t AND column_name=col
      ) THEN
        -- backfill NULLs so SET NOT NULL won't fail
        EXECUTE format('UPDATE public.%I SET %I = now() WHERE %I IS NULL', t, col, col);

        -- add DEFAULT now() if missing
        SELECT EXISTS (
          SELECT 1
          FROM pg_attrdef d
          JOIN pg_class c ON c.oid = d.adrelid
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
          WHERE c.relname = t AND a.attname = col
        ) INTO has_default;

        IF NOT has_default THEN
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT now()', t, col);
        END IF;

        -- ensure NOT NULL
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, col);
      END IF;
    END LOOP;
  END LOOP;
END$$;`);
    const touch = async (table) => {
      await sql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'set_updated_at_${table}' AND tgrelid = 'public.${table}'::regclass
        ) THEN
          EXECUTE 'CREATE TRIGGER set_updated_at_${table}
                   BEFORE UPDATE ON public.${table}
                   FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at()';
        END IF;
      END$$;`);
    };
    for (const t of [
      'billing_plans','billing_subscriptions','billing_invoices',
      'billing_invoice_items','billing_payments','billing_entitlements'
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await touch(t);
    }

    /* 7) Foreign keys */
    await sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
      ) THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_subscriptions_tenant_fk') THEN
          ALTER TABLE public.billing_subscriptions
          ADD CONSTRAINT billing_subscriptions_tenant_fk
          FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
          ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_invoices_tenant_fk') THEN
          ALTER TABLE public.billing_invoices
          ADD CONSTRAINT billing_invoices_tenant_fk
          FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
          ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_entitlements_tenant_fk') THEN
          ALTER TABLE public.billing_entitlements
          ADD CONSTRAINT billing_entitlements_tenant_fk
          FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
          ON UPDATE CASCADE ON DELETE CASCADE;
        END IF;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_subscriptions_plan_fk') THEN
        ALTER TABLE public.billing_subscriptions
        ADD CONSTRAINT billing_subscriptions_plan_fk
        FOREIGN KEY (plan_id) REFERENCES public.billing_plans(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_invoices_sub_fk') THEN
        ALTER TABLE public.billing_invoices
        ADD CONSTRAINT billing_invoices_sub_fk
        FOREIGN KEY (subscription_id) REFERENCES public.billing_subscriptions(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_invoice_items_invoice_fk') THEN
        ALTER TABLE public.billing_invoice_items
        ADD CONSTRAINT billing_invoice_items_invoice_fk
        FOREIGN KEY (invoice_id) REFERENCES public.billing_invoices(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='billing_payments_invoice_fk') THEN
        ALTER TABLE public.billing_payments
        ADD CONSTRAINT billing_payments_invoice_fk
        FOREIGN KEY (invoice_id) REFERENCES public.billing_invoices(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END$$;`);

    /* 8) Seed plans */
    await sql(`
      INSERT INTO public.billing_plans (code, name, description, price_cents, currency, "interval", features, is_active)
      VALUES
        ('basic','Basic','Starter plan', 0,    'USD', 'month'::billing_interval, '{"limits":{"borrowers":1000,"loans":2000},"modules":{"savings":true,"collections":true}}'::jsonb, true),
        ('pro',  'Pro',  'Business plan', 2900, 'USD', 'month'::billing_interval, '{"limits":{"borrowers":10000,"loans":20000},"modules":{"savings":true,"collections":true,"assets":true,"accounting":true}}'::jsonb, true)
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            price_cents = EXCLUDED.price_cents,
            currency = EXCLUDED.currency,
            "interval" = EXCLUDED."interval",
            features = EXCLUDED.features,
            is_active = EXCLUDED.is_active,
            updated_at = now();
    `);
  },

  down: async (queryInterface /*, Sequelize */) => {
    const sql = queryInterface.sequelize.query.bind(queryInterface.sequelize);

    await sql(`DROP TABLE IF EXISTS public.billing_entitlements;`);
    await sql(`DROP TABLE IF EXISTS public.billing_payments;`);
    await sql(`DROP TABLE IF EXISTS public.billing_invoice_items;`);
    await sql(`DROP TABLE IF EXISTS public.billing_invoices;`);
    await sql(`DROP TABLE IF EXISTS public.billing_subscriptions;`);
    await sql(`DROP TABLE IF EXISTS public.billing_plans;`);

    await sql(`DROP FUNCTION IF EXISTS public.tg_set_updated_at;`);

    await sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_entitlement_source') THEN
        DROP TYPE billing_entitlement_source;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_payment_status') THEN
        DROP TYPE billing_payment_status;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_invoice_status') THEN
        DROP TYPE billing_invoice_status;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_subscription_status') THEN
        DROP TYPE billing_subscription_status;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval') THEN
        DROP TYPE billing_interval;
      END IF;
    END$$;`);
  }
};
