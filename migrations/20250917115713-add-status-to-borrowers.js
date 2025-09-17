'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add "status" to public."Borrowers" only if missing
    const t = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable({ tableName: 'Borrowers', schema: 'public' });

      if (!table.status) {
        await queryInterface.addColumn(
          { tableName: 'Borrowers', schema: 'public' },
          'status',
          {
            // keep it simple (TEXT/STRING) to avoid ENUM headaches
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: 'active', // existing rows become "active"
          },
          { transaction: t }
        );

        await queryInterface.addIndex(
          { tableName: 'Borrowers', schema: 'public' },
          ['status'],
          { name: 'Borrowers_status_idx', transaction: t }
        );
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    // Safe rollback
    await queryInterface.removeIndex(
      { tableName: 'Borrowers', schema: 'public' },
      'Borrowers_status_idx'
    ).catch(() => {});
    await queryInterface.removeColumn(
      { tableName: 'Borrowers', schema: 'public' },
      'status'
    ).catch(() => {});
  },
};
