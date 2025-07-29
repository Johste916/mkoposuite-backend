module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define('Branch', {
    name: DataTypes.STRING,
    location: DataTypes.STRING
  });

  return Branch;
};
