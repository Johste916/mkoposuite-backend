// Minimal SavingsTransaction model used by savings endpoints & reports
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
        type: DataTypes.INTEGER,
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
      reversed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
