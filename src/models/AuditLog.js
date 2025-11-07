// backend/src/models/AuditLog.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      // Users.id is UUID in your DB — keep mapping to snake column
      userId: {
        field: 'user_id',
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      // Branch PK is integer
      branchId: {
        field: 'branch_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'branches', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      category: { type: DataTypes.STRING(64),  allowNull: true },
      action:   { type: DataTypes.STRING(128), allowNull: true },
      message:  { type: DataTypes.TEXT,        allowNull: true },
      ip:       { type: DataTypes.STRING(64),  allowNull: true },

      reversed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'audit_logs',
      freezeTableName: true,
      timestamps: true,
      underscored: false,          // align with global camel timestamps
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    }
  );

  return AuditLog;
};
