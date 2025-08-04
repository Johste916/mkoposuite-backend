module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define('UserRoles', {
    userId: DataTypes.INTEGER,
    roleId: DataTypes.INTEGER,
  });

  return UserRole;
};
