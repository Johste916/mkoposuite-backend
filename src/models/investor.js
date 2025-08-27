'use strict';

module.exports = (sequelize, DataTypes) => {
  const Investor = sequelize.define('Investor', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    tenantId: { type: DataTypes.UUID, allowNull: true, index: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    phone: { type: DataTypes.STRING(40), allowNull: true },
    email: { type: DataTypes.STRING(120), allowNull: true, validate: { isEmail: true } },
    address: { type: DataTypes.STRING(250), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('ACTIVE', 'INACTIVE'), allowNull: false, defaultValue: 'ACTIVE' },
    productsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'investors',
    paranoid: true,
    timestamps: true,
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['name'] },
      { fields: ['phone'] },
      { fields: ['email'] },
    ],
  });

  return Investor;
};
