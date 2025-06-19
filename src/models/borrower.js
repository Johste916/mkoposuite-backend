// models/borrower.js
module.exports = (sequelize, DataTypes) => {
    const Borrower = sequelize.define('Borrower', {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      nationalId: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    });
  
    Borrower.associate = (models) => {
      Borrower.hasMany(models.Loan, { foreignKey: 'borrowerId' });
    };
  
    return Borrower;
  };