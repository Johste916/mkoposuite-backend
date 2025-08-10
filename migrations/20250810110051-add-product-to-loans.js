'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('loans', 'product_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'loan_products', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('loans', 'product_id');
  }
};
