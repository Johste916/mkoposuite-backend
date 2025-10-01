// migrations/20251001_add_entity_cols_to_audit_logs.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'audit_logs';
    // Add columns if they don’t exist
    await queryInterface.sequelize.transaction(async (t) => {
      const [cols] = await queryInterface.sequelize.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${table}'`,
        { transaction: t }
      );
      const names = new Set(cols.map(c => c.column_name));

      if (!names.has('entity_type')) {
        await queryInterface.addColumn(table, 'entity_type', { type: Sequelize.STRING }, { transaction: t });
      }
      if (!names.has('entity_id')) {
        await queryInterface.addColumn(table, 'entity_id', { type: Sequelize.BIGINT }, { transaction: t });
      }

      // Helpful indexes
      await queryInterface.addIndex(table, ['entity_type', 'entity_id'], { name: 'audit_logs_entity_idx', transaction: t })
        .catch(() => {});
      await queryInterface.addIndex(table, ['category', 'action'], { name: 'audit_logs_cat_action_idx', transaction: t })
        .catch(() => {});
    });
  },

  async down(queryInterface) {
    const table = 'audit_logs';
    await queryInterface.removeIndex(table, 'audit_logs_entity_idx').catch(() => {});
    await queryInterface.removeIndex(table, 'audit_logs_cat_action_idx').catch(() => {});
    await queryInterface.removeColumn(table, 'entity_type').catch(() => {});
    await queryInterface.removeColumn(table, 'entity_id').catch(() => {});
  }
};
