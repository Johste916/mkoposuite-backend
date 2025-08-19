// Minimal SavingsTransaction model used by savings-transactions endpoints & reports
module.exports = (sequelize, DataTypes) => {
  const SavingsTransaction = sequelize.define(
    'SavingsTransaction',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      borrowerId: {
        type: DataTypes.INTEGER, // matches typical Borrower PK (integer)
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('deposit', 'withdrawal', 'interest', 'charge'),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'SavingsTransactions',
      timestamps: true,
      indexes: [
        { fields: ['borrowerId'] },
        { fields: ['type'] },
        { fields: ['date'] },
      ],
    }
  );

  return SavingsTransaction;
};
