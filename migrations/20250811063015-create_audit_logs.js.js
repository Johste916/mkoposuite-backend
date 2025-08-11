"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("AuditLogs", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      entityType: { type: Sequelize.STRING, allowNull: false }, // 'Loan','Repayment', etc.
      entityId: { type: Sequelize.INTEGER, allowNull: false },
      action: { type: Sequelize.STRING, allowNull: false }, // 'create','update','approve','disburse','close'
      before: { type: Sequelize.JSONB, allowNull: true },
      after: { type: Sequelize.JSONB, allowNull: true },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      ip: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("AuditLogs", ["entityType", "entityId"]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("AuditLogs", ["entityType", "entityId"]);
    await queryInterface.dropTable("AuditLogs");
  },
};
