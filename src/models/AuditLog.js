// backend/src/models/AuditLog.js
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      // IMPORTANT: Users.id is UUID in your DB — match that here
      userId: {
        field: 'user_id',
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'Users', key: 'id' }, // quoted table "Users"
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      // Your Branch PK is integer (per your existing models)
      branchId: {
        field: 'branch_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'branches', key: 'id' }, // unquoted (lowercase) table
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },

      category: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      reversed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'audit_logs',
      underscored: true,
      timestamps: true,
    }
  );

  return AuditLog;
};
