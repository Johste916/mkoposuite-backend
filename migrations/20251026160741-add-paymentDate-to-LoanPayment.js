'use strict';

/**
 * Safe, idempotent migration for environments where public."LoanPayment" might be a VIEW.
 * - If VIEW: CREATE OR REPLACE VIEW based on existing definition, adding:
 *     - "paymentDate" from (paymentDate | payment_date | created_at)
 *     - "amountPaid" from (amountPaid | amount)  **only if it doesn't already exist**
 * - If TABLE: add "paymentDate" column + backfill + index (no-op if already present).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;
    const schema = 'public';
    const name = 'LoanPayment';
    const fqname = `${schema}."${name}"`;

    // Helper: does the relation exist and what kind is it?
    const [relRows] = await sequelize.query(
      `
        SELECT c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :schema
          AND c.relname = :name
        LIMIT 1;
      `,
      { replacements: { schema, name } }
    );

    if (!relRows.length) {
      throw new Error(`Relation ${fqname} not found`);
    }
    const relkind = relRows[0].relkind; // 'v' view, 'm' matview, 'r' table

    // Helper: check if a column exists on the relation (works for tables & views)
    async function hasColumn(col) {
      const [rows] = await sequelize.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = :schema
            AND table_name   = :name
            AND column_name  = :col
          LIMIT 1;
        `,
        { replacements: { schema, name, col } }
      );
      return rows.length > 0;
    }

    // Bail early if paymentDate already exists
    if (await hasColumn('paymentDate')) {
      console.log('[migrate] LoanPayment.paymentDate already exists — skipping');
      return;
    }

    if (relkind === 'v' || relkind === 'm') {
      // ----- VIEW / MATVIEW path -----
      // Get current view SELECT (no CREATE ...), and strip any trailing semicolon
      const [defRows] = await sequelize.query(
        `SELECT pg_get_viewdef(:fqname::regclass, true) AS viewdef;`,
        { replacements: { fqname: fqname } }
      );
      const rawDef = (defRows[0] && defRows[0].viewdef) || '';
      const innerSelect = rawDef.trim().replace(/;+\s*$/g, '');

      // Determine what columns currently come out of the view
      const [colRows] = await sequelize.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = :schema
            AND table_name   = :name
          ORDER BY ordinal_position;
        `,
        { replacements: { schema, name } }
      );
      const existingCols = new Set(colRows.map(r => r.column_name));

      // Build computed expressions that only reference existing columns
      const pickFirstExisting = (...cands) => cands.find(c => existingCols.has(c));
      const paymentDateExprSource =
        pickFirstExisting('paymentDate', 'payment_date', 'payment_date') || // both quoted and unquoted
        pickFirstExisting('created_at') ||
        null;

      // If none of the candidates exist, use NULL (still creates the column)
      const paymentDateExpr = paymentDateExprSource
        ? `"sub"."${paymentDateExprSource}"`
        : `NULL`;

      // We only add amountPaid if it's not already present in the view
      const shouldAddAmountPaid = !existingCols.has('amountPaid');
      let amountPaidExpr = '';
      if (shouldAddAmountPaid) {
        const amountPaidSource =
          pickFirstExisting('amountPaid') ||
          pickFirstExisting('amount') ||
          null;
        const amountExpr = amountPaidSource ? `"sub"."${amountPaidSource}"` : `NULL`;
        amountPaidExpr = `,\n  COALESCE(${amountExpr}, 0)::numeric AS "amountPaid"`;
      }

      const sql = `
        CREATE OR REPLACE VIEW ${fqname} AS
        SELECT
          sub.*,
          COALESCE(${paymentDateExpr}) AS "paymentDate"
          ${amountPaidExpr}
        FROM (
          ${innerSelect}
        ) AS sub;
      `;

      await sequelize.query(sql);
      console.log('[migrate] Replaced VIEW LoanPayment with computed "paymentDate"' + (shouldAddAmountPaid ? ' and "amountPaid"' : ''));

      return;
    }

    if (relkind === 'r') {
      // ----- TABLE path -----
      // Add column if needed
      await qi.addColumn({ schema, tableName: name }, 'paymentDate', {
        type: Sequelize.DATE,
        allowNull: true,
      });

      // Backfill: prefer payment_date; fallback created_at
      const [snakeRows] = await sequelize.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = :schema
            AND table_name   = :name
            AND column_name  = 'payment_date'
          LIMIT 1;
        `,
        { replacements: { schema, name } }
      );
      const hasSnake = snakeRows.length > 0;

      if (hasSnake) {
        await sequelize.query(
          `UPDATE ${fqname} SET "paymentDate" = COALESCE(payment_date, created_at) WHERE "paymentDate" IS NULL;`
        );
      } else {
        await sequelize.query(
          `UPDATE ${fqname} SET "paymentDate" = created_at WHERE "paymentDate" IS NULL;`
        );
      }

      try {
        await qi.addIndex({ schema, tableName: name }, ['paymentDate'], { name: 'loanpayment_paymentdate_idx' });
      } catch { /* ignore duplicate */ }

      console.log('[migrate] Added column LoanPayment.paymentDate and backfilled');
      return;
    }

    throw new Error(`Unsupported relkind for ${fqname}: ${relkind}`);
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;
    const schema = 'public';
    const name = 'LoanPayment';
    const fqname = `${schema}."${name}"`;

    const [relRows] = await sequelize.query(
      `
        SELECT c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :schema
          AND c.relname = :name
        LIMIT 1;
      `,
      { replacements: { schema, name } }
    );
    const relkind = relRows[0]?.relkind;

    if (relkind === 'v' || relkind === 'm') {
      // We don't try to rebuild the exact previous view — safe no-op.
      console.log('[down] LoanPayment is a view — leaving as-is (no-op)');
      return;
    }

    if (relkind === 'r') {
      try { await qi.removeIndex({ schema, tableName: name }, 'loanpayment_paymentdate_idx'); } catch {}
      // Drop the column if exists
      const [cols] = await sequelize.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = :schema
            AND table_name   = :name
            AND column_name  = 'paymentDate'
          LIMIT 1;
        `,
        { replacements: { schema, name } }
      );
      if (cols.length) {
        await qi.removeColumn({ schema, tableName: name }, 'paymentDate');
      }
    }
  },
};
