'use strict';

/**
 * Idempotent, non-transactional migration for loan_payments extensions.
 * - Adds columns only if they don't exist
 * - Avoids long locks by not wrapping in a single transaction
 * - Keeps existing types (e.g., ENUM status) intact
 */

module.exports = {
  // Tell sequelize-cli not to wrap this in a single transaction
  useTransaction: false,

  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const JSON_TYPE = dialect === 'postgres' ? Sequelize.JSONB : Sequelize.JSON;

    // Describe once; if table doesn't exist, this will throw and surface quickly.
    const table = await queryInterface.describeTable('loan_payments');

    const addIfMissing = async (col, def) => {
      if (!table[col]) {
        try {
          await queryInterface.addColumn('loan_payments', col, def);
          // console.log(`+ loan_payments.${col}`);
        } catch (e) {
          // tolerate concurrent/previous runs
          if (!/already exists/i.test(e.message)) throw e;
        }
      }
    };

    // Core metadata
    await addIfMissing('reference', { type: Sequelize.STRING, allowNull: true });

    // If status is missing, add it (keep it simple STRING by default to avoid enum churn).
    // If you already have an ENUM from a previous migration, this block will be skipped.
    await addIfMissing('status',   { type: Sequelize.STRING, allowNull: true }); // 'pending'|'approved'|'rejected'|'voided'
    await addIfMissing('applied',  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addIfMissing('allocation', { type: JSON_TYPE, allowNull: true });
    await addIfMissing('currency', { type: Sequelize.STRING(8), allowNull: true });
    await addIfMissing('receiptNo',{ type: Sequelize.STRING, allowNull: true });
    await addIfMissing('gateway',  { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('gatewayRef',{ type: Sequelize.STRING, allowNull: true });

    // Optional audit/posting fields (safe no-ops if unused)
    await addIfMissing('postedBy',      { type: Sequelize.UUID, allowNull: true });
    await addIfMissing('postedByName',  { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('postedByEmail', { type: Sequelize.STRING, allowNull: true });

    await addIfMissing('voidReason', { type: Sequelize.STRING, allowNull: true });

    // Indexes — Postgres IF NOT EXISTS; fallback to addIndex elsewhere
    const ensureIndex = async (name, cols) => {
      if (dialect === 'postgres') {
        await queryInterface.sequelize
          .query(`CREATE INDEX IF NOT EXISTS "${name}" ON "public"."loan_payments" (${cols.map(c => `"${c}"`).join(', ')});`)
          .catch(() => {});
      } else {
        try {
          // Some dialects don’t support named IF NOT EXISTS easily; ignore if it exists
          await queryInterface.addIndex('loan_payments', cols, { name });
        } catch (_) {}
      }
    };

    // Dedup index on (loanId, method, reference) when reference is present (PG only)
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS loan_payments_dedupe_idx ' +
        'ON "loan_payments" ("loanId","method","reference") ' +
        'WHERE "reference" IS NOT NULL;'
      ).catch(() => {});
    }

    // Read/perf index
    await ensureIndex('loan_payments_loanId_paymentDate_idx', ['loanId', 'paymentDate']);
  },

  async down(queryInterface /*, Sequelize */) {
    const dialect = queryInterface.sequelize.getDialect();

    // Drop indexes (ignore if missing)
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS loan_payments_dedupe_idx;').catch(() => {});
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS "loan_payments_loanId_paymentDate_idx";').catch(() => {});
    } else {
      await queryInterface.removeIndex('loan_payments', 'loan_payments_dedupe_idx').catch(() => {});
      await queryInterface.removeIndex('loan_payments', 'loan_payments_loanId_paymentDate_idx').catch(() => {});
    }

    // Drop columns if they exist
    const existing = await queryInterface.describeTable('loan_payments').catch(() => ({}));
    const dropIfExists = async (col) => {
      if (existing[col]) {
        await queryInterface.removeColumn('loan_payments', col).catch(() => {});
      }
    };

    for (const col of [
      'reference','status','applied','allocation','currency',
      'receiptNo','gateway','gatewayRef','postedBy','postedByName',
      'postedByEmail','voidReason'
    ]) {
      await dropIfExists(col);
    }

    // Do NOT drop ENUM types here; this migration uses STRING for status.
    // If you previously created an ENUM type, leave it in place (it may still be referenced).
  },
};
