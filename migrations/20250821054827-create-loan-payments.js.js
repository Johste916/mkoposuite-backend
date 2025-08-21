// migrations/20240820-create-loan-payments.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("loan_payments", {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      loanId: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: "loans", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      amount: { type: Sequelize.DECIMAL(18,2), allowNull: false },
      currency: { type: Sequelize.STRING(8), defaultValue: "TZS" },
      method: { type: Sequelize.STRING(32), defaultValue: "cash" },
      reference: { type: Sequelize.STRING(128) },
      notes: { type: Sequelize.TEXT },
      allocation: { type: Sequelize.JSONB },  // [{period, principal, interest, fees, penalties}]
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      postedBy: {
        type: Sequelize.BIGINT,
        references: { model: "Users", key: "id" },
        onUpdate: "SET NULL",
        onDelete: "SET NULL",
      },
    });

    await queryInterface.addIndex("loan_payments", ["loanId"]);
    await queryInterface.addIndex("loan_payments", ["date"]);
    await queryInterface.addIndex("loan_payments", ["method"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("loan_payments");
  },
};
