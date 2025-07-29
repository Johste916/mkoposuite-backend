module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define('Borrower', {
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nationalId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true
    }
  });

  return Borrower;
};
