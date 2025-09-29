/* eslint-disable @typescript-eslint/no-var-requires */
"use strict";

/**
 * Safe, idempotent compat migration for `loans`:
 * - Adds commonly referenced columns IF NOT EXISTS (no-op if present).
 * - Creates a read-only view `v_loans_compat` exposing both snake_case and camelCase
 *   aliases, useful for debugging/analytics and guarding against stray SELECTs.
 *
 * This does NOT drop any columns, and does NOT change existing data.
 */

module.exports = {
  up: async (queryInterface /*, Sequelize */) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    // 1) Ensure likely-referenced columns exist (no-op if they already do)
    // NOTE: Your DB already has most of these; keeping IF NOT EXISTS makes this safe.
    await sql(`
      ALTER TABLE public.loans
        ADD COLUMN IF NOT EXISTS total_paid               numeric(14,2)   DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_interest           numeric(14,2)   DEFAULT 0,
        ADD COLUMN IF NOT EXISTS outstanding              numeric(14,2)   DEFAULT 0,
        ADD COLUMN IF NOT EXISTS term_months              integer,
        ADD COLUMN IF NOT EXISTS product_id               integer,
        ADD COLUMN IF NOT EXISTS approval_date            timestamptz,
        ADD COLUMN IF NOT EXISTS rejection_date           timestamptz,
        ADD COLUMN IF NOT EXISTS closed_date              timestamptz,
        ADD COLUMN IF NOT EXISTS close_reason             text,
        ADD COLUMN IF NOT EXISTS rescheduled_from_id      integer,
        ADD COLUMN IF NOT EXISTS top_up_of_id             integer
    `);

    // Camel case columns you’re actively using are already present in your dump,
    // e.g. disbursementDate, disbursementMethod, startDate, endDate, etc.
    // We keep them as-is.

    // 2) Create (or replace) a read-only compatibility view
    //    exposing BOTH styles for most commonly used fields.
    await sql(`
      CREATE OR REPLACE VIEW public.v_loans_compat AS
      SELECT
        l.id,
        -- borrower/branch
        l."borrowerId"                              AS "borrowerId",
        l."branchId"                                AS "branchId",

        -- product
        COALESCE(l.product_id, l."productId")       AS product_id,
        COALESCE(l."productId", l.product_id)       AS "productId",

        -- identifiers
        l.reference,

        -- amounts & rates
        l.amount,
        l.currency,
        l."interestRate"                            AS "interestRate",
        COALESCE(l.term_months, l."termMonths")     AS term_months,
        COALESCE(l."termMonths", l.term_months)     AS "termMonths",
        l."totalInterest"                           AS "totalInterest",
        l.total_interest                            AS total_interest,
        l.total_paid                                AS total_paid,
        l.outstanding,

        -- schedule helpers
        l."nextDueDate"                             AS "nextDueDate",
        l."nextDueAmount"                           AS "nextDueAmount",

        -- dates (both styles)
        l."startDate"                               AS "startDate",
        l."endDate"                                 AS "endDate",
        l."approvalDate"                            AS "approvalDate",
        l.approval_date                             AS approval_date,
        l."rejectionDate"                           AS "rejectionDate",
        l.rejection_date                            AS rejection_date,
        l."disbursementDate"                        AS "disbursementDate",
        l.disbursement_date                         AS disbursement_date,

        -- methods / enums stored as text in DB
        l."repaymentFrequency"                      AS "repaymentFrequency",
        l."interestMethod"                          AS "interestMethod",
        l.status                                    AS status,

        -- users
        l."initiated_by"                            AS initiated_by,
        l."initiatedBy"                             AS "initiatedBy",
        l."approved_by"                             AS approved_by,
        l."approvedBy"                              AS "approvedBy",
        l."rejected_by"                             AS rejected_by,
        l."rejectedBy"                              AS "rejectedBy",
        l."disbursed_by"                            AS disbursed_by,
        l."disbursedBy"                             AS "disbursedBy",
        l."closed_by"                               AS closed_by,

        -- closing
        l."closedDate"                              AS "closedDate",
        l.closed_date                               AS closed_date,
        l."closeReason"                             AS "closeReason",
        l.close_reason                              AS close_reason,

        -- relations
        l."rescheduledFromId"                       AS "rescheduledFromId",
        l.rescheduled_from_id                       AS rescheduled_from_id,
        l."topUpOfId"                               AS "topUpOfId",
        l.top_up_of_id                              AS top_up_of_id,

        -- disbursement method (only camel exists in your table)
        l."disbursementMethod"                      AS "disbursementMethod",

        -- meta
        l."createdAt"                               AS "createdAt",
        l."updatedAt"                               AS "updatedAt"
      FROM public.loans l;
    `);

    // The view is read-only (no triggers). Your app should continue INSERT/UPDATE
    // against public.loans as it does today.
  },

  down: async (queryInterface /*, Sequelize */) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    // Drop the view only. We don't drop added columns on down (safe choice).
    await sql(`DROP VIEW IF EXISTS public.v_loans_compat;`);
  },
};
