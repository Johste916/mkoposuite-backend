"use strict";
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define("AuditLog", {
    entityType: DataTypes.STRING,
    entityId: DataTypes.INTEGER,
    action: DataTypes.STRING,
    before: DataTypes.JSONB,
    after: DataTypes.JSONB,
    userId: DataTypes.INTEGER,
    ip: DataTypes.STRING,
  }, { timestamps: true, updatedAt: false });

  return AuditLog;
};
