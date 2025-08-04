// models/savingstransaction.js
module.exports = (sequelize, DataTypes) => {
  const SavingsTransaction = sequelize.define('SavingsTransaction', {
    borrowerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('deposit', 'withdrawal', 'charge', 'interest'),
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    notes: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reversed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  });

  SavingsTransaction.associate = (models) => {
    SavingsTransaction.belongsTo(models.Borrower, {
      foreignKey: 'borrowerId',
      as: 'borrower',
    });
  };

  return SavingsTransaction;
};
