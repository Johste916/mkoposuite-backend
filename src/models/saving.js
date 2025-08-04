// models/saving.js
module.exports = (sequelize, DataTypes) => {
  const Saving = sequelize.define('Saving', {
    borrowerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('deposit', 'withdrawal'),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  Saving.associate = (models) => {
    Saving.belongsTo(models.Borrower, { foreignKey: 'borrowerId' });
  };

  return Saving;
};
