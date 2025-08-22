'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('collection_sheets', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'), // requires pgcrypto or uuid-ossp
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      collector: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      loanOfficer: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      branchId: {
        type: Sequelize.UUID,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      collectorId: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      loanOfficerId: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('collection_sheets');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_collection_sheets_status;');
  },
};
