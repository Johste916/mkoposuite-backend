// models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name:     { type: DataTypes.STRING, allowNull: false },
      location: { type: DataTypes.STRING, allowNull: true },

      // DB column is snake_case
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },

      phone:    { type: DataTypes.STRING, allowNull: true },
      address:  { type: DataTypes.STRING, allowNull: true },

      code: { type: DataTypes.VIRTUAL, get() { return null; } },
    },
    {
      tableName: 'branches',
      freezeTableName: true,
      timestamps: true,
      underscored: false, // this table uses camel timestamps in your setup
      defaultScope: {
        attributes: ['id', 'name', 'location', 'tenantId', 'phone', 'address', 'createdAt', 'updatedAt'],
      },
      indexes: [
        { fields: ['tenant_id'] },
        { fields: ['name'] },
      ],
    }
  );

  Branch.associate = (models) => {
    if (models.User && !Branch.associations?.Users) {
      Branch.hasMany(models.User,     { foreignKey: 'branchId', as: 'Users' });
    }
    if (models.Borrower && !Branch.associations?.Borrowers) {
      Branch.hasMany(models.Borrower, { foreignKey: 'branchId', as: 'Borrowers' });
    }
    if (models.Loan && !Branch.associations?.Loans) {
      Branch.hasMany(models.Loan,     { foreignKey: 'branchId', as: 'Loans' });
    }
  };

  return Branch;
};
