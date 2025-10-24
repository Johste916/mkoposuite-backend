'use strict';

module.exports = {
  async up(queryInterface) {
    // Drop first to avoid shape conflicts
    await queryInterface.sequelize.query(`
      DROP VIEW IF EXISTS v_loan_payments_compat CASCADE;
      DROP VIEW IF EXISTS v_loans_compat CASCADE;
    `);

    // ---------------- v_loans_compat (no FUNCTION/PROCEDURE) ----------------
    await queryInterface.sequelize.query(`
DO $$
DECLARE
  loans_reg regclass := to_regclass('public.loans');
  tbl   text := 'loans';
  cols  text := '';
  sep   text := '';
  expr  text;
  has   boolean;
  c     text;
BEGIN
  -- If base table missing, create a stub view (no rows)
  IF loans_reg IS NULL THEN
    EXECUTE '
      CREATE OR REPLACE VIEW v_loans_compat AS
      SELECT
        NULL::int        AS "id",
        NULL::int        AS "borrowerId",
        NULL::int        AS "productId",
        NULL::int        AS "branchId",
        NULL::numeric    AS "amount",
        NULL::text       AS "currency",
        NULL::text       AS "status",
        NULL::timestamp  AS "disbursementDate",
        NULL::timestamp  AS "createdAt",
        NULL::timestamp  AS "updatedAt",
        NULL::int        AS "officerId"
      WHERE false';
    RETURN;
  END IF;

  -- Always include id
  cols := cols || 'l.id AS "id"';
  sep  := ', ';

  -- Helper pattern: find first existing candidate, respecting camelCase quoting
  -- borrowerId
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['borrowerId','borrower_id'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "borrowerId"'; sep := ', '; END IF;

  -- productId
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['productId','product_id'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "productId"'; sep := ', '; END IF;

  -- branchId
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['branchId','branch_id'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "branchId"'; sep := ', '; END IF;

  -- amount (numeric)
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['amount','principal','principalAmount','loanAmount'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN expr := '('||expr||')::numeric'; cols := cols || sep || expr || ' AS "amount"'; sep := ', '; END IF;

  -- currency
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['currency'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "currency"'; sep := ', '; END IF;

  -- status
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['status'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "status"'; sep := ', '; END IF;

  -- disbursementDate
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['disbursement_date','disbursementDate','disbursedAt','release_date','releaseDate','start_date','startDate'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "disbursementDate"'; sep := ', '; END IF;

  -- createdAt
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['createdAt','created_at'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "createdAt"'; sep := ', '; END IF;

  -- updatedAt
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['updatedAt','updated_at'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "updatedAt"'; sep := ', '; END IF;

  -- officerId
  expr := NULL;
  FOREACH c IN ARRAY ARRAY['loanOfficerId','officerId','userId','disbursed_by','loan_officer_id'] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl
        AND (column_name=c OR column_name=lower(c))
    ) INTO has;
    IF has THEN expr := CASE WHEN c ~ '[A-Z]' THEN 'l."'||c||'"' ELSE 'l.'||c END; EXIT; END IF;
  END LOOP;
  IF expr IS NOT NULL THEN cols := cols || sep || expr || ' AS "officerId"'; sep := ', '; END IF;

  EXECUTE 'CREATE OR REPLACE VIEW v_loans_compat AS SELECT ' || cols || ' FROM public.' || quote_ident(tbl) || ' l';
END $$;
    `);

    // ---------------- v_loan_payments_compat (array_append fix) ----------------
    await queryInterface.sequelize.query(`
DO $$
DECLARE
  src_reg   regclass := COALESCE(to_regclass('public."LoanPayment"'), to_regclass('public.loan_payments'));
  src_name  text;
  sel       text := '';
  parts     text[] := ARRAY[]::text[];
  has       boolean;
  c         text;
  arr       text[];
BEGIN
  -- If no payments table, create stub view (no rows)
  IF src_reg IS NULL THEN
    EXECUTE '
      CREATE OR REPLACE VIEW v_loan_payments_compat AS
      SELECT
        NULL::int        AS "id",
        NULL::int        AS "loanId",
        NULL::numeric    AS "amountPaid",
        NULL::timestamp  AS "paymentDate",
        ''approved''::text AS "status",
        true             AS "applied",
        NULL::int        AS "borrowerId",
        NULL::int        AS "productId",
        NULL::text       AS "officerId",
        NULL::int        AS "branchId",
        NULL::timestamp  AS "createdAt"
      WHERE false';
    RETURN;
  END IF;

  SELECT relname INTO src_name FROM pg_class WHERE oid = src_reg;

  -- id
  parts := array_append(parts, 'p.id AS "id"');

  -- Utility inline: collect only existing candidates, then COALESCE if >1
  -- loanId
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['loanId','loan_id'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::int'
    ) || ' AS "loanId"'
  );

  -- amountPaid
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['amountPaid','amount','paid_amount','payment_amount'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]||'::numeric'
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')::numeric' END,
      'NULL::numeric'
    ) || ' AS "amountPaid"'
  );

  -- paymentDate
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['paymentDate','payment_date','date','createdAt','created_at'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::timestamp'
    ) || ' AS "paymentDate"'
  );

  -- status (default 'approved')
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['status'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, 'p.status'); END IF;
  END LOOP;
  parts := array_append(parts,
    CASE
      WHEN array_length(arr,1) IS NULL THEN '''approved''::text'
      WHEN array_length(arr,1)=1 THEN 'COALESCE('||arr[1]||', ''approved'')'
      ELSE 'COALESCE('||array_to_string(arr, ', ')||', ''approved'')'
    END || ' AS "status"'
  );

  -- applied (default true)
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['applied'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, 'p.applied'); END IF;
  END LOOP;
  parts := array_append(parts,
    CASE
      WHEN array_length(arr,1) IS NULL THEN 'true'
      WHEN array_length(arr,1)=1 THEN 'COALESCE('||arr[1]||', true)'
      ELSE 'COALESCE('||array_to_string(arr, ', ')||', true)'
    END || ' AS "applied"'
  );

  -- borrowerId
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['borrowerId','borrower_id'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::int'
    ) || ' AS "borrowerId"'
  );

  -- productId
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['productId','product_id'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::int'
    ) || ' AS "productId"'
  );

  -- officerId (text)
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['officerId','loan_officer_id','user_id'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]||'::text'
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')::text' END,
      'NULL::text'
    ) || ' AS "officerId"'
  );

  -- branchId
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['branchId','branch_id'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::int'
    ) || ' AS "branchId"'
  );

  -- createdAt
  arr := ARRAY[]::text[];
  FOREACH c IN ARRAY ARRAY['createdAt','created_at'] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=src_name
                      AND (column_name=c OR column_name=lower(c))) INTO has;
    IF has THEN arr := array_append(arr, CASE WHEN c ~ '[A-Z]' THEN 'p."'||c||'"' ELSE 'p.'||c END); END IF;
  END LOOP;
  parts := array_append(parts,
    COALESCE(
      CASE WHEN array_length(arr,1) IS NULL THEN NULL
           WHEN array_length(arr,1)=1 THEN arr[1]
           ELSE 'COALESCE('||array_to_string(arr, ', ')||')' END,
      'NULL::timestamp'
    ) || ' AS "createdAt"'
  );

  -- Finalize view
  sel := array_to_string(parts, ', ');
  EXECUTE format('CREATE OR REPLACE VIEW v_loan_payments_compat AS SELECT %s FROM public.%I p', sel, src_name);
END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP VIEW IF EXISTS v_loan_payments_compat CASCADE;
      DROP VIEW IF EXISTS v_loans_compat CASCADE;
    `);
  },
};
