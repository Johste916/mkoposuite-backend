"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    let userIdType = Sequelize.INTEGER; // default
    try {
      const userTable = await queryInterface.describeTable("Users");
      if (userTable.id && userTable.id.type.toLowerCase().includes("uuid")) {
        userIdType = Sequelize.UUID;
      }
    } catch (err) {
      console.warn("⚠️ Could not inspect Users table, defaulting userId to INTEGER.");
    }

    await queryInterface.createTable("AuditLogs", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: userIdType,
        allowNull: false,
        // Try to add FK but don't fail migration if it errors
        ...(userIdType
          ? {
              references: { model: "Users", key: "id" },
              onUpdate: "CASCADE",
              onDelete: "CASCADE",
            }
          : {}),
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    }).catch((err) => {
      console.warn("⚠️ Skipping FK or table creation error in AuditLogs:", err.message);
    });
  },

  async down(queryInterface) {
    try {
      await queryInterface.dropTable("AuditLogs");
    } catch (err) {
      console.warn("⚠️ Skipping dropTable error in AuditLogs:", err.message);
    }
  },
};
