'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING } = Sequelize;

    await queryInterface.createTable('communication_attachments', {
      id: { type: INTEGER, autoIncrement: true, primaryKey: true },

      communication_id: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'communications', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      file_name: { type: STRING, allowNull: false },
      mime_type: { type: STRING, allowNull: false },
      size: { type: INTEGER, allowNull: false },
      file_url: { type: STRING, allowNull: false },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('communication_attachments', ['communication_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('communication_attachments');
  },
};
