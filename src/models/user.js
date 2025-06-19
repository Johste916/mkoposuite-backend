// backend/src/models/user.js

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    name: DataTypes.STRING,
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: DataTypes.STRING,
    role: DataTypes.STRING,
    branchId: DataTypes.INTEGER,
  });

  return User;
};
