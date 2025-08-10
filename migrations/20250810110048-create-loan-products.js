'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('loan_products', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING, allowNull: false, unique: true },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },

      interest_method: { type: Sequelize.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat' },
      interest_rate: { type: Sequelize.DECIMAL(10,4), allowNull: false, defaultValue: 0 },

      min_principal: { type: Sequelize.DECIMAL(14,2), allowNull: true },
      max_principal: { type: Sequelize.DECIMAL(14,2), allowNull: true },
      min_term_months: { type: Sequelize.INTEGER, allowNull: true },
      max_term_months: { type: Sequelize.INTEGER, allowNull: true },

      penalty_rate: { type: Sequelize.DECIMAL(10,4), allowNull: true },

      fees: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      eligibility: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('loan_products');
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_loan_products_status";`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_loan_products_interest_method";`);
  }
};
