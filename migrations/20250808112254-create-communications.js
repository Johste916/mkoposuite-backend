'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, ENUM, BOOLEAN, DATE } = Sequelize;

    // If your DB/dialect doesn’t support ENUM, change ENUM to STRING here and in the model.
    await queryInterface.createTable('communications', {
      id: { type: INTEGER, autoIncrement: true, primaryKey: true },

      title: { type: STRING, allowNull: false },
      text: { type: TEXT, allowNull: false },

      type: { type: ENUM('notice', 'policy', 'alert', 'guideline'), allowNull: false, defaultValue: 'notice' },
      priority: { type: ENUM('low', 'normal', 'high', 'critical'), allowNull: false, defaultValue: 'normal' },

      audience_role: { type: STRING, allowNull: true },
      audience_branch_id: { type: INTEGER, allowNull: true },

      start_at: { type: DATE, allowNull: true },
      end_at: { type: DATE, allowNull: true },

      show_on_dashboard: { type: BOOLEAN, allowNull: false, defaultValue: true },
      show_in_ticker: { type: BOOLEAN, allowNull: false, defaultValue: true },

      is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },

      created_by: { type: INTEGER, allowNull: true },
      updated_by: { type: INTEGER, allowNull: true },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('communications', ['type']);
    await queryInterface.addIndex('communications', ['priority']);
    await queryInterface.addIndex('communications', ['audience_branch_id']);
    await queryInterface.addIndex('communications', ['is_active']);
    await queryInterface.addIndex('communications', ['show_on_dashboard']);
    await queryInterface.addIndex('communications', ['show_in_ticker']);
    await queryInterface.addIndex('communications', ['start_at']);
    await queryInterface.addIndex('communications', ['end_at']);
  },

  async down(queryInterface) {
    // Drop dependent enums first in Postgres
    await queryInterface.dropTable('communications');
    // In Postgres, also clean ENUMs (optional):
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communications_type";');
    // await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communications_priority";');
  },
};
