'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tExists = await queryInterface.sequelize.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='tenant_users'
    `);
    if (tExists[0].length) return;

    await queryInterface.createTable('tenant_users', {
      id:          { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id:   { type: Sequelize.UUID, allowNull: false,
                     references: { model: { tableName: 'tenants', schema: 'public' }, key: 'id' },
                     onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      user_id:     { type: Sequelize.UUID, allowNull: false,
                     references: { model: { tableName: 'Users', schema: 'public' }, key: 'id' },
                     onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      role:        { type: Sequelize.STRING, allowNull: false, defaultValue: 'staff' },
      createdAt:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('tenant_users', {
      type: 'unique',
      fields: ['tenant_id', 'user_id'],
      name: 'uq_tenant_user_once',
    });
    await queryInterface.addIndex('tenant_users', ['tenant_id']);
    await queryInterface.addIndex('tenant_users', ['user_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_users');
  },
};
