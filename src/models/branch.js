// backend/src/models/branch.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:        { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      name:      { type: DataTypes.STRING, allowNull: false },
      code:      { type: DataTypes.STRING },
      phone:     { type: DataTypes.STRING },
      address:   { type: DataTypes.TEXT },
      managerId: { type: DataTypes.BIGINT, field: 'manager_id' },
      tenantId:  { type: DataTypes.UUID,   field: 'tenant_id' },

      // Important: map the timestamp fields to camelCase columns that already exist
      createdAt: { type: DataTypes.DATE, field: 'createdAt' },
      updatedAt: { type: DataTypes.DATE, field: 'updatedAt' },
      deletedAt: { type: DataTypes.DATE, field: 'deletedAt' }, // ← match existing column
    },
    {
      tableName: 'branches',
      timestamps: true,
      paranoid: true,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      deletedAt: 'deletedAt', // ← this makes Sequelize generate "Branch"."deletedAt" IS NULL
      underscored: false,     // keep camelCase for this table (since DB already uses it)
    }
  );

  Branch.associate = (models) => {
    if (models.User) {
      Branch.hasMany(models.User, { foreignKey: 'branchId', as: 'Users' });
    }
  };

  return Branch;
};
