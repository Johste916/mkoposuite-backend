"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Add the column with a default so existing rows are valid
    await queryInterface.addColumn(
      { schema: "public", tableName: "loan_payments" },
      "status",
      {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: "approved", // historical data is considered posted/approved
      }
    );

    // 2) Optional: index for fast queues and reports
    await queryInterface.addIndex(
      { schema: "public", tableName: "loan_payments" },
      ["status", "createdAt"],
      {
        name: "loan_payments_status_createdAt_idx",
      }
    );
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex(
        { schema: "public", tableName: "loan_payments" },
        "loan_payments_status_createdAt_idx"
      );
    } catch (_) {}
    await queryInterface.removeColumn(
      { schema: "public", tableName: "loan_payments" },
      "status"
    );
  },
};
