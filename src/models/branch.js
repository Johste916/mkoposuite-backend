'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      // Keep the model minimal to match your live table ("Branches": id, name)
      // Add optional fields here only if they truly exist in the DB.
      // code: DataTypes.STRING,
      // phone: DataTypes.STRING,
      // address: DataTypes.TEXT,
    },
    {
      tableName: 'Branches',   // matches your live DB
      timestamps: true,        // createdAt/updatedAt exist in your BorrowerGroups; ok to keep for Branch too
      paranoid: false,         // <-- critical: stop adding "deletedAt IS NULL"
    }
  );

  Branch.associate = (models) => {
    if (models.User) {
      Branch.hasMany(models.User, { foreignKey: 'branchId', as: 'Users' });
    }
    if (models.Borrower) {
      Branch.hasMany(models.Borrower, { foreignKey: 'branchId', as: 'Borrowers' });
    }
  };

  return Branch;
};
