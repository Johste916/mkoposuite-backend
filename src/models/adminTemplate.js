'use strict';
module.exports = (sequelize, DataTypes) => {
  const AdminTemplate = sequelize.define('AdminTemplate', {
    name:      { type: DataTypes.STRING, allowNull:false },
    subject:   { type: DataTypes.STRING, allowNull:true },
    body:      { type: DataTypes.TEXT,   allowNull:false, defaultValue: "" },
    channel:   { type: DataTypes.STRING, allowNull:false, defaultValue: "email" },
    category:  { type: DataTypes.STRING, allowNull:false },
    tenantId:  { type: DataTypes.UUID,   allowNull:true },
  }, {
    tableName: 'admin_templates',
    underscored: false,
  });
  return AdminTemplate;
};
