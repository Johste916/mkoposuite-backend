// src/models/Permission.js
module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define("Permission", {
    action: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    roles: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    }
  });

  return Permission;
};
