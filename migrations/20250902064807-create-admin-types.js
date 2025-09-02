'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_types', {
      id:         { type: Sequelize.INTEGER, primaryKey:true, autoIncrement:true },
      name:       { type: Sequelize.STRING, allowNull:false },
      code:       { type: Sequelize.STRING, allowNull:true },
      category:   { type: Sequelize.STRING, allowNull:false, index: true },
      meta:       { type: Sequelize.JSONB, allowNull:true },
      tenantId:   { type: Sequelize.UUID, allowNull:true },
      createdAt:  { type: Sequelize.DATE, allowNull:false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:  { type: Sequelize.DATE, allowNull:false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('admin_types', ['category']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('admin_types');
  }
};
