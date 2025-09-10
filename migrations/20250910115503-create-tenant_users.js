'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'tenant_users', schema: 'public' },
      {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: { tableName: 'tenants', schema: 'public' }, key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'public' }, key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        role: { type: Sequelize.STRING, allowNull: false, defaultValue: 'staff' },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      }
    );

    await queryInterface.addConstraint(
      { tableName: 'tenant_users', schema: 'public' },
      {
        fields: ['tenant_id', 'user_id'],
        type: 'unique',
        name: 'tenant_users_tenant_user_unique',
      }
    );
    await queryInterface.addIndex({ tableName: 'tenant_users', schema: 'public' }, ['tenant_id']);
    await queryInterface.addIndex({ tableName: 'tenant_users', schema: 'public' }, ['user_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'tenant_users', schema: 'public' });
  },
};
