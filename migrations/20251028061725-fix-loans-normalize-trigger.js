'use strict';

module.exports = {
  async up (queryInterface) {
    await queryInterface.sequelize.query(`
CREATE OR REPLACE FUNCTION loans_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  j jsonb := to_jsonb(NEW);

  has_outstanding        boolean := (j ? 'outstanding');
  has_outstandingAmount  boolean := (j ? 'outstandingAmount');

  v_amount         numeric := COALESCE((j->>'amount')::numeric, 0);
  v_total_interest numeric := COALESCE((j->>'totalInterest')::numeric,
                                       (j->>'total_interest')::numeric, 0);
  v_total_paid     numeric := COALESCE((j->>'total_paid')::numeric, 0);

  v_existing_outstanding numeric := COALESCE((j->>'outstanding')::numeric, NULL);
  v_existing_out_amt     numeric := COALESCE((j->>'outstandingAmount')::numeric, NULL);

  v_outstanding numeric;
BEGIN
  v_outstanding := COALESCE(
    v_existing_outstanding,
    v_existing_out_amt,
    v_amount + v_total_interest - v_total_paid
  );

  IF has_outstanding THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('outstanding', v_outstanding));
  END IF;

  IF has_outstandingAmount THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('outstandingAmount', v_outstanding));
  END IF;

  RETURN NEW;
END;
$$;
    `);

    await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.loans'::regclass
      AND tgname  = 'trg_loans_normalize'
  ) THEN
    CREATE TRIGGER trg_loans_normalize
      BEFORE INSERT OR UPDATE ON public.loans
      FOR EACH ROW
      EXECUTE FUNCTION loans_normalize();
  END IF;
END$$;
    `);
  },

  async down (queryInterface) {
    // No-op version on rollback (keeps trigger but does nothing harmful)
    await queryInterface.sequelize.query(`
CREATE OR REPLACE FUNCTION loans_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN RETURN NEW; END $$;
    `);
  }
};
