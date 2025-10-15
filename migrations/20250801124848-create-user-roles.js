'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('UserRoles', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      roleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Roles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Composite uniqueness to prevent duplicate assignments
    await queryInterface.addConstraint('UserRoles', {
      fields: ['userId', 'roleId'],
      type: 'unique',
      name: 'userroles_userid_roleid_uniq',
    });

    await queryInterface.addIndex('UserRoles', ['userId']);
    await queryInterface.addIndex('UserRoles', ['roleId']);
  },

  down: async (queryInterface) => {
    await queryInterface.removeConstraint('UserRoles', 'userroles_userid_roleid_uniq').catch(() => {});
    await queryInterface.dropTable('UserRoles');
  },
};
