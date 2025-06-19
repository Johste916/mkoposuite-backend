// models/branch.js
module.exports = (sequelize, DataTypes) => {
    const Branch = sequelize.define('Branch', {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    });
  
    Branch.associate = (models) => {
      Branch.hasMany(models.User, { foreignKey: 'branchId' });
      Branch.hasMany(models.Loan, { foreignKey: 'branchId' });
    };
  
    return Branch;
  };