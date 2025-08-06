module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define('UserBranches', {
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  });

  UserBranch.associate = (models) => {
    UserBranch.belongsTo(models.User, {
      foreignKey: 'userId',
      onDelete: 'CASCADE',
    });
    UserBranch.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      onDelete: 'CASCADE',
    });
  };

  return UserBranch;
};
