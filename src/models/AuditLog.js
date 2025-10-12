'use strict';

module.exports = (sequelize, DataTypes) => {
  const JSON_TYPE =
    sequelize.getDialect && sequelize.getDialect() === 'postgres'
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      // users.id is UUID in your DB
      userId: {
        field: 'user_id',
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      branchId: {
        field: 'branch_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'branches', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      category: { type: DataTypes.STRING(64), allowNull: true },   // "auth", "users", "loans", ...
      action:   { type: DataTypes.STRING(128), allowNull: true },  // "create","update","delete","login:success", ...
      entity:   { type: DataTypes.STRING(64), allowNull: true },   // "User","Loan","Repayment", ...
      entityId: { type: DataTypes.STRING(64), allowNull: true },

      message:  { type: DataTypes.TEXT, allowNull: true },         // short human message
      ip:       { type: DataTypes.STRING(64), allowNull: true },
      userAgent:{ type: DataTypes.STRING(512), allowNull: true },

      meta:     { type: JSON_TYPE, allowNull: true, defaultValue: null }, // any extra fields
      before:   { type: JSON_TYPE, allowNull: true, defaultValue: null }, // snapshot (redacted)
      after:    { type: JSON_TYPE, allowNull: true, defaultValue: null }, // snapshot (redacted)

      reversed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'audit_logs', underscored: true, timestamps: true }
  );

  AuditLog.associate = (models) => {
    if (models.User)   AuditLog.belongsTo(models.User,   { foreignKey: 'user_id',   as: 'User' });
    if (models.Branch) AuditLog.belongsTo(models.Branch, { foreignKey: 'branch_id', as: 'Branch' });
  };

  return AuditLog;
};
