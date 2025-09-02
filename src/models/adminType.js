'use strict';
module.exports = (sequelize, DataTypes) => {
  const AdminType = sequelize.define('AdminType', {
    name:      { type: DataTypes.STRING, allowNull:false },
    code:      { type: DataTypes.STRING, allowNull:true },
    category:  { type: DataTypes.STRING, allowNull:false },
    meta:      { type: DataTypes.JSONB,  allowNull:true },
    tenantId:  { type: DataTypes.UUID,   allowNull:true },
  }, {
    tableName: 'admin_types',
    underscored: false,
  });
  return AdminType;
};
