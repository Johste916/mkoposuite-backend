"use strict";
module.exports = {
  async up(q, S) {
    await q.createTable("DisbursementBatches", {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      status: { type: S.ENUM("queued","sent","failed","posted"), defaultValue: "queued" },
      errorMessage: { type: S.STRING },
      createdBy: { type: S.INTEGER },
      createdAt: { type: S.DATE, defaultValue: S.fn("NOW") },
      updatedAt: { type: S.DATE, defaultValue: S.fn("NOW") },
    });
    await q.createTable("DisbursementItems", {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      batchId: {
        type: S.INTEGER, references: { model: "DisbursementBatches", key: "id" },
        onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      loanId: {
        type: S.INTEGER, references: { model: "loans", key: "id" },
        onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      amount: { type: S.DECIMAL(18,2), defaultValue: 0 },
      status: { type: S.ENUM("queued","sent","failed","posted"), defaultValue: "queued" },
      errorMessage: { type: S.STRING },
      createdAt: { type: S.DATE, defaultValue: S.fn("NOW") },
      updatedAt: { type: S.DATE, defaultValue: S.fn("NOW") },
    });
  },
  async down(q) {
    await q.dropTable("DisbursementItems");
    await q.dropTable("DisbursementBatches");
  }
};
