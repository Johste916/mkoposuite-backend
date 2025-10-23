// models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name:     { type: DataTypes.STRING, allowNull: false },
      location: { type: DataTypes.STRING, allowNull: true },

      // ✅ Map to snake_case in DB
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },

      // Optional: these exist in your raw queries
      phone:    { type: DataTypes.STRING, allowNull: true },
      address:  { type: DataTypes.STRING, allowNull: true },

      // Virtual stays virtual — no SQL will try to select a non-existent column
      code: {
        type: DataTypes.VIRTUAL,
        get() { return null; }
      },
    },
    {
      tableName: 'branches',
      freezeTableName: true,
      timestamps: true,      // your table has createdAt/updatedAt (camelCase)
      underscored: false,    // keep camelCase timestamps
      defaultScope: {
        attributes: ['id', 'name', 'location', 'tenantId', 'phone', 'address', 'createdAt', 'updatedAt'],
      },
      scopes: {
        byTenant(tenantId) { return { where: { tenantId } }; },
      },
    }
  );

  Branch.associate = (models) => {
    if (models.User)     Branch.hasMany(models.User,     { foreignKey: 'branchId', as: 'Users' });
    if (models.Borrower) Branch.hasMany(models.Borrower, { foreignKey: 'branchId', as: 'Borrowers' });
    if (models.Loan)     Branch.hasMany(models.Loan,     { foreignKey: 'branchId', as: 'Loans' });
  };

  return Branch;
};
