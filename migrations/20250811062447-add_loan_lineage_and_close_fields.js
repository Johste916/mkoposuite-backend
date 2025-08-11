"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Loans", "closedBy", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("Loans", "closedDate", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn("Loans", "closeReason", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn("Loans", "rescheduledFromId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Loans", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("Loans", "topUpOfId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Loans", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Optional tracking fields if missing
    const table = await queryInterface.describeTable("Loans");
    if (!table.totalPaid) {
      await queryInterface.addColumn("Loans", "totalPaid", {
        type: Sequelize.DECIMAL(18, 2),
        defaultValue: 0,
      });
    }
    if (!table.outstanding) {
      await queryInterface.addColumn("Loans", "outstanding", {
        type: Sequelize.DECIMAL(18, 2),
        defaultValue: 0,
      });
    }
    if (!table.totalInterest) {
      await queryInterface.addColumn("Loans", "totalInterest", {
        type: Sequelize.DECIMAL(18, 2),
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "closedBy");
    await queryInterface.removeColumn("Loans", "closedDate");
    await queryInterface.removeColumn("Loans", "closeReason");
    await queryInterface.removeColumn("Loans", "rescheduledFromId");
    await queryInterface.removeColumn("Loans", "topUpOfId");
    // Keeping totals in place in case they are used elsewhere
  },
};
