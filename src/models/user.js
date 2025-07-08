module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'password_hash' // ✅ CORRECT: maps to the real DB column
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: 'staff'
    }
  });

  return User;
};
