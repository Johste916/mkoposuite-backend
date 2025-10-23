// models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name:      { type: DataTypes.STRING, allowNull: false },
      location:  { type: DataTypes.STRING, allowNull: true },

      // Multi-tenant (optional but recommended — keep nullable if you haven't backfilled yet)
      tenantId:  { type: DataTypes.UUID, allowNull: true },

      // Compatibility shim: some legacy code may read Branch.code; keep it virtual so we don't
      // require a DB column and we never push "dummy" data.
      code: {
        type: DataTypes.VIRTUAL,
        get() {
          // return something stable if you want (e.g., code from name/id); null is also fine.
          return null;
        },
      },
    },
    {
      tableName: 'branches',   // ✅ use the system table (lowercase) you showed in your dump
      freezeTableName: true,   // don't pluralize or mutate
      timestamps: true,        // ✅ your table has createdAt / updatedAt
      underscored: false,      // matches createdAt / updatedAt casing
      // If later you rename timestamp columns, map with: createdAt: 'createdAt', updatedAt: 'updatedAt'
      defaultScope: {
        // Keep attributes to real columns to avoid selecting non-existent fields anywhere
        attributes: ['id', 'name', 'location', 'tenantId', 'createdAt', 'updatedAt'],
      },
      scopes: {
        byTenant(tenantId) {
          return { where: { tenantId } };
        },
      },
    }
  );

  Branch.associate = (models) => {
    // Keep existing relationships; these don't force writes of fake rows
    if (models.User) {
      Branch.hasMany(models.User, { foreignKey: 'branchId', as: 'Users' });
    }
    if (models.Borrower) {
      Branch.hasMany(models.Borrower, { foreignKey: 'branchId', as: 'Borrowers' });
    }
    if (models.Loan) {
      Branch.hasMany(models.Loan, { foreignKey: 'branchId', as: 'Loans' });
    }
  };

  return Branch;
};
