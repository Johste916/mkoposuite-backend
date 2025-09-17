// 20250917074029-add-branch-id-to-borrowers.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      // Check existing columns first (safe re-run)
      const desc = await queryInterface.describeTable('Borrowers');

      // 1) Add branch_id if missing
      if (!desc.branch_id) {
        await queryInterface.addColumn(
          'Borrowers',
          'branch_id',
          {
            type: Sequelize.INTEGER,
            allowNull: true, // keep flexible to avoid breaking existing data
            references: {
              // IMPORTANT: actual table name is lowercase 'branches'
              model: { tableName: 'branches' },
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          { transaction: t }
        );
      }

      // 2) If legacy camelCase column exists, backfill
      if (desc.branchId && !desc.branch_id) {
        await queryInterface.sequelize.query(
          'UPDATE "Borrowers" SET "branch_id" = "branchId" WHERE "branch_id" IS NULL',
          { transaction: t }
        );
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      const desc = await queryInterface.describeTable('Borrowers');
      if (desc.branch_id) {
        await queryInterface.removeColumn('Borrowers', 'branch_id', { transaction: t });
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
