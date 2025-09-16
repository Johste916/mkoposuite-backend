// migrations/XXXXXXXXXXXX-create-user-branches.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('user_branches', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      branch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onDelete: 'CASCADE',
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('user_branches', {
      fields: ['user_id', 'branch_id'],
      type: 'unique',
      name: 'user_branches_user_branch_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('user_branches');
  },
};
