module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define('Borrower', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    fullName: {
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
    address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  });

  return Borrower;
};
