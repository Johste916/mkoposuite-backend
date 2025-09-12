'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name:     { type: DataTypes.STRING, allowNull: false },
      code:     { type: DataTypes.STRING },

      // ✅ New columns you said you'll add in DB
      phone:    { type: DataTypes.STRING, allowNull: true },   // column: phone
      address:  { type: DataTypes.TEXT,   allowNull: true },   // column: address

      // DB has "manager" (not manager_id). Map to a friendly attribute if you need it:
      managerId:{ type: DataTypes.STRING, field: 'manager', allowNull: true },

      // DB has tenant_id
      tenantId: { type: DataTypes.STRING, field: 'tenant_id', allowNull: true },
    },
    {
      tableName: 'branches',
      timestamps: true,
      // ✅ Your table uses snake_case timestamps
      createdAt: 'created_at',
      updatedAt: 'updated_at',

      // ✅ Your table already has camel-cased "deletedAt"
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
