module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define('UserBranches', {
    userId: DataTypes.INTEGER,
    branchId: DataTypes.INTEGER,
  });

  return UserBranch;
};
