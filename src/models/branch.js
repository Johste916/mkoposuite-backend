module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define('Branch', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    location: {
      type: DataTypes.STRING,
    },
  });

  Branch.associate = (models) => {
    Branch.belongsToMany(models.User, {
      through: 'UserBranches',
      foreignKey: 'branchId',
    });
  };

  return Branch;
};
