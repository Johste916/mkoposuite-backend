'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanCategory = sequelize.define(
    'LoanCategory',
    {
      name:        { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      status:      { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
    },
    {
      tableName: 'LoanCategories',      // explicit to avoid dialect surprises
      freezeTableName: true,
      timestamps: true,                 // createdAt/updatedAt camel (default)
      underscored: false,
      indexes: [
        { fields: ['name'] },
        { fields: ['status'] },
      ],
    }
  );
  return LoanCategory;
};
