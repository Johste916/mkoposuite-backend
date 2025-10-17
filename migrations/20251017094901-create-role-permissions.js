'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('RolePermissions', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      roleId: { type: Sequelize.UUID, allowNull: false },
      permissionId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await qi.addIndex('RolePermissions', ['roleId', 'permissionId'], { unique: true, name: 'role_permissions_unique_pair' });
    await qi.addIndex('RolePermissions', ['roleId']);
    await qi.addIndex('RolePermissions', ['permissionId']);
  },

  async down(qi) {
    await qi.dropTable('RolePermissions');
  },
};
