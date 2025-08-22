'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Inspect current columns to only add what's missing
    const t = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('loan_payments');

      if (!table.reference) {
        await queryInterface.addColumn('loan_payments', 'reference', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      // These help the new flows (pending/approve/void + allocation preview)
      if (!table.status) {
        await queryInterface.addColumn('loan_payments', 'status', {
          type: Sequelize.STRING, // 'pending' | 'approved' | 'rejected' | 'voided'
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.applied) {
        await queryInterface.addColumn('loan_payments', 'applied', {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        }, { transaction: t });
      }

      if (!table.allocation) {
        // PG-specific; OK to be JSON if you're on MySQL
        await queryInterface.addColumn('loan_payments', 'allocation', {
          type: Sequelize.JSONB,
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.currency) {
        await queryInterface.addColumn('loan_payments', 'currency', {
          type: Sequelize.STRING(8),
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.receiptNo) {
        await queryInterface.addColumn('loan_payments', 'receiptNo', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.gateway) {
        await queryInterface.addColumn('loan_payments', 'gateway', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.gatewayRef) {
        await queryInterface.addColumn('loan_payments', 'gatewayRef', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.postedBy) {
        await queryInterface.addColumn('loan_payments', 'postedBy', {
          type: Sequelize.UUID,
          allowNull: true,
        }, { transaction: t });
      }
      if (!table.postedByName) {
        await queryInterface.addColumn('loan_payments', 'postedByName', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }
      if (!table.postedByEmail) {
        await queryInterface.addColumn('loan_payments', 'postedByEmail', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      if (!table.voidReason) {
        await queryInterface.addColumn('loan_payments', 'voidReason', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t });
      }

      // Idempotency/duplicate guard: only when reference is present
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS loan_payments_dedupe_idx ' +
        'ON "loan_payments" ("loanId","method","reference") ' +
        'WHERE "reference" IS NOT NULL;',
        { transaction: t }
      );

      // Helpful read index
      const hasLoanDateIdx = (await queryInterface.showIndex('loan_payments'))
        .some(i => i.name === 'loan_payments_loanId_paymentDate_idx');
      if (!hasLoanDateIdx) {
        await queryInterface.addIndex('loan_payments', ['loanId', 'paymentDate'], {
          name: 'loan_payments_loanId_paymentDate_idx',
          transaction: t,
        });
      }

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('loan_payments', 'loan_payments_dedupe_idx').catch(() => {});
    await queryInterface.removeIndex('loan_payments', 'loan_payments_loanId_paymentDate_idx').catch(() => {});
    for (const col of [
      'reference','status','applied','allocation','currency',
      'receiptNo','gateway','gatewayRef','postedBy','postedByName',
      'postedByEmail','voidReason'
    ]) {
      await queryInterface.removeColumn('loan_payments', col).catch(() => {});
    }
  },
};
