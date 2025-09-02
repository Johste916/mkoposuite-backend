'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_templates', {
      id:         { type: Sequelize.INTEGER, primaryKey:true, autoIncrement:true },
      name:       { type: Sequelize.STRING, allowNull:false },
      subject:    { type: Sequelize.STRING, allowNull:true },
      body:       { type: Sequelize.TEXT,   allowNull:false, defaultValue: "" },
      channel:    { type: Sequelize.STRING, allowNull:false, defaultValue: "email" },
      category:   { type: Sequelize.STRING, allowNull:false },
      tenantId:   { type: Sequelize.UUID, allowNull:true },
      createdAt:  { type: Sequelize.DATE, allowNull:false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:  { type: Sequelize.DATE, allowNull:false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('admin_templates', ['category']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('admin_templates');
  }
};
