"use strict";
module.exports = (sequelize, DataTypes) => {
  const DisbursementItem = sequelize.define("DisbursementItem", {
    batchId: DataTypes.INTEGER,
    loanId: DataTypes.INTEGER,
    amount: DataTypes.DECIMAL(18,2),
    status: { type: DataTypes.ENUM("queued","sent","failed","posted"), defaultValue: "queued" },
    errorMessage: DataTypes.STRING,
  });
  DisbursementItem.associate = (models) => {
    DisbursementItem.belongsTo(models.DisbursementBatch, { foreignKey: "batchId" });
    DisbursementItem.belongsTo(models.Loan, { foreignKey: "loanId" });
  };
  return DisbursementItem;
};
