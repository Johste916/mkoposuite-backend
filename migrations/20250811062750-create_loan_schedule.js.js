"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("LoanSchedules", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      loanId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Loans", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      period: { type: Sequelize.INTEGER, allowNull: false },
      dueDate: { type: Sequelize.DATEONLY, allowNull: false },
      principal: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      interest: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      fees: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      penalties: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      total: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },

      principalPaid: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      interestPaid: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      feesPaid: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      penaltiesPaid: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      paid: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },

      status: {
        type: Sequelize.ENUM("upcoming", "overdue", "paid"),
        defaultValue: "upcoming",
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex("LoanSchedules", ["loanId", "period"], { unique: true });
    await queryInterface.addIndex("LoanSchedules", ["loanId", "dueDate"]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("LoanSchedules", ["loanId", "period"]);
    await queryInterface.removeIndex("LoanSchedules", ["loanId", "dueDate"]);
    await queryInterface.dropTable("LoanSchedules");
  },
};
