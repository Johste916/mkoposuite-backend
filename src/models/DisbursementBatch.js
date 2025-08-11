"use strict";
module.exports = (sequelize, DataTypes) => {
  const DisbursementBatch = sequelize.define("DisbursementBatch", {
    status: { type: DataTypes.ENUM("queued","sent","failed","posted"), defaultValue: "queued" },
    errorMessage: DataTypes.STRING,
    createdBy: DataTypes.INTEGER,
  });
  DisbursementBatch.associate = (models) => {
    DisbursementBatch.hasMany(models.DisbursementItem, { foreignKey: "batchId", as: "items" });
  };
  return DisbursementBatch;
};
