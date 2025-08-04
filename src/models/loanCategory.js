module.exports = (sequelize, DataTypes) => {
  const LoanCategory = sequelize.define('LoanCategory', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: DataTypes.STRING,
  });
  return LoanCategory;
};
