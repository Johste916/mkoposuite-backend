"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Helper to safely add a column if missing
    const safeAddColumn = async (tableName, columnName, definition) => {
      try {
        const table = await queryInterface.describeTable(tableName);
        if (!table[columnName]) {
          await queryInterface.addColumn(tableName, columnName, definition);
          console.log(`✅ Added column ${columnName} to ${tableName}`);
        } else {
          console.log(`⏭️ Skipped adding ${columnName}, already exists in ${tableName}`);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped ${columnName} on ${tableName} — reason: ${err.message}`);
      }
    };

    await safeAddColumn("loans", "closedBy", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await safeAddColumn("loans", "closedDate", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await safeAddColumn("loans", "closeReason", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await safeAddColumn("loans", "rescheduledFromId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "loans", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await safeAddColumn("loans", "topUpOfId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "loans", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await safeAddColumn("loans", "totalPaid", {
      type: Sequelize.DECIMAL(18, 2),
      defaultValue: 0,
    });

    await safeAddColumn("loans", "outstanding", {
      type: Sequelize.DECIMAL(18, 2),
      defaultValue: 0,
    });

    await safeAddColumn("loans", "totalInterest", {
      type: Sequelize.DECIMAL(18, 2),
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    const safeRemoveColumn = async (tableName, columnName) => {
      try {
        const table = await queryInterface.describeTable(tableName);
        if (table[columnName]) {
          await queryInterface.removeColumn(tableName, columnName);
          console.log(`🗑️ Removed column ${columnName} from ${tableName}`);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped removing ${columnName} — reason: ${err.message}`);
      }
    };

    await safeRemoveColumn("loans", "closedBy");
    await safeRemoveColumn("loans", "closedDate");
    await safeRemoveColumn("loans", "closeReason");
    await safeRemoveColumn("loans", "rescheduledFromId");
    await safeRemoveColumn("loans", "topUpOfId");
  },
};
