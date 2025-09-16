// backend/src/models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name:     { type: DataTypes.STRING, allowNull: false },
      code:     { type: DataTypes.STRING, allowNull: false },

      phone:    { type: DataTypes.STRING, allowNull: true },
      address:  { type: DataTypes.TEXT,   allowNull: true },

      // keep compatibility with your existing field name mapping
      managerId:{ type: DataTypes.STRING, field: 'manager', allowNull: true },

      tenantId: { type: DataTypes.STRING, field: 'tenant_id', allowNull: true },

      // support paranoid
      deletedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'branches',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      paranoid: true,
      deletedAt: 'deletedAt',
      underscored: false,
    }
  );

  Branch.associate = (models) => {
    if (models.User) {
      Branch.hasMany(models.User, { foreignKey: 'branchId', as: 'Users' });
    }
  };

  return Branch;
};
