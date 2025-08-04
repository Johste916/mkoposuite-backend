module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });

  User.associate = (models) => {
    User.belongsToMany(models.Role, {
      through: 'UserRoles',
      foreignKey: 'userId',
    });
    User.belongsToMany(models.Branch, {
      through: 'UserBranches',
      foreignKey: 'userId',
    });
  };

  return User;
};
