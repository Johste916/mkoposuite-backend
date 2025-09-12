// backend/models/bank.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING },
    branch: { type: DataTypes.STRING },
    accountName: { type: DataTypes.STRING },
    accountNumber: { type: DataTypes.STRING },
    swift: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    address: { type: DataTypes.TEXT },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'banks',
    underscored: false,
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'name'] },
    ],
  });

  Bank.associate = function(models) {
    // (optional) if you later relate loans -> banks
    // Bank.hasMany(models.Loan, { foreignKey: 'disbursementBankId' });
  };

  return Bank;
};
