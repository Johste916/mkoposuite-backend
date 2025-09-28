// migrations/20250928171721-fix-loan-schedules-columns.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const { sequelize } = qi;
    const qg = qi.sequelize.getQueryInterface().queryGenerator;
    const table = 'loan_schedules';
    const qTable = qg.quoteTable(table); // -> e.g. "public"."loan_schedules" or "loan_schedules"

    await sequelize.transaction(async (t) => {
      const describe = async () => {
        try { return await qi.describeTable(table, { transaction: t }); }
        catch { return {}; }
      };
      let desc = await describe();
      const has = (c) => Object.prototype.hasOwnProperty.call(desc, c);

      // 1) Rename camelCase leftovers → snake_case
      if (has('loanId') && !has('loan_id')) {
        await qi.renameColumn(table, 'loanId', 'loan_id', { transaction: t });
      }
      if (has('createdAt') && !has('created_at')) {
        await qi.renameColumn(table, 'createdAt', 'created_at', { transaction: t });
      }
      if (has('updatedAt') && !has('updated_at')) {
        await qi.renameColumn(table, 'updatedAt', 'updated_at', { transaction: t });
      }

      // refresh description
      desc = await describe();
      const has2 = (c) => Object.prototype.hasOwnProperty.call(desc, c);

      // 2) Core columns
      if (!has2('loan_id')) {
        await qi.addColumn(table, 'loan_id',
          { type: Sequelize.INTEGER, allowNull: false },
          { transaction: t });
      }
      if (!has2('period')) {
        await qi.addColumn(table, 'period',
          { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
          { transaction: t });
      }
      if (!has2('due_date')) {
        await qi.addColumn(table, 'due_date',
          { type: Sequelize.DATEONLY, allowNull: true },
          { transaction: t });
      }
      if (!has2('principal')) {
        await qi.addColumn(table, 'principal',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('interest')) {
        await qi.addColumn(table, 'interest',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('fees')) {
        await qi.addColumn(table, 'fees',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('penalties')) {
        await qi.addColumn(table, 'penalties',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('total')) {
        await qi.addColumn(table, 'total',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }

      // 3) Paid breakdown & flags
      if (!has2('principal_paid')) {
        await qi.addColumn(table, 'principal_paid',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('interest_paid')) {
        await qi.addColumn(table, 'interest_paid',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('fees_paid')) {
        await qi.addColumn(table, 'fees_paid',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('penalties_paid')) {
        await qi.addColumn(table, 'penalties_paid',
          { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          { transaction: t });
      }
      if (!has2('paid')) {
        await qi.addColumn(table, 'paid',
          { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          { transaction: t });
      }
      if (!has2('status')) {
        await qi.addColumn(table, 'status',
          { type: Sequelize.STRING, allowNull: false, defaultValue: 'upcoming' },
          { transaction: t });
      }

      // 4) Timestamps (snake_case)
      if (!has2('created_at')) {
        await qi.addColumn(table, 'created_at',
          { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          { transaction: t });
      }
      if (!has2('updated_at')) {
        await qi.addColumn(table, 'updated_at',
          { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          { transaction: t });
      }

      // 5) Backfill sensible defaults
      await sequelize.query(
        `
        UPDATE ${qTable}
           SET principal       = COALESCE(principal, 0),
               interest        = COALESCE(interest, 0),
               fees            = COALESCE(fees, 0),
               penalties       = COALESCE(penalties, 0),
               total           = COALESCE(total, 0),
               principal_paid  = COALESCE(principal_paid, 0),
               interest_paid   = COALESCE(interest_paid, 0),
               fees_paid       = COALESCE(fees_paid, 0),
               penalties_paid  = COALESCE(penalties_paid, 0),
               paid            = COALESCE(paid, false),
               status          = COALESCE(status, 'upcoming'),
               created_at      = COALESCE(created_at, NOW()),
               updated_at      = COALESCE(updated_at, NOW())
        `,
        { transaction: t }
      );

      // 6) Indices/constraints
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS loan_schedules_loan_id_idx ON ${qTable} (loan_id);`,
        { transaction: t }
      );
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS loan_schedules_unique_loan_period ON ${qTable} (loan_id, period);`,
        { transaction: t }
      );
    });
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const { sequelize } = qi;
    const qg = qi.sequelize.getQueryInterface().queryGenerator;
    const table = 'loan_schedules';
    const qTable = qg.quoteTable(table);

    await sequelize.transaction(async (t) => {
      const describe = async () => {
        try { return await qi.describeTable(table, { transaction: t }); }
        catch { return {}; }
      };
      const desc = await describe();
      const has = (c) => Object.prototype.hasOwnProperty.call(desc, c);
      const dropIf = async (c) => { if (has(c)) await qi.removeColumn(table, c, { transaction: t }); };

      await sequelize.query(
        `DROP INDEX IF EXISTS loan_schedules_unique_loan_period; DROP INDEX IF EXISTS loan_schedules_loan_id_idx;`,
        { transaction: t }
      );

      // Remove only the additive columns
      await dropIf('principal_paid');
      await dropIf('interest_paid');
      await dropIf('fees_paid');
      await dropIf('penalties_paid');
      await dropIf('paid');
      await dropIf('status');

      // Keep snake_case; avoiding renaming back to camelCase to not break code.
    });
  },
};
