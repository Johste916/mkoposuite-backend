// models/branch.js (Sequelize version)
module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      code: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      location: {
        type: DataTypes.STRING
      },
      manager: {
        type: DataTypes.STRING // or a foreign key to User if needed
      }
    },
    {
      tableName: 'branches',
      underscored: true,
      timestamps: true
    }
  );

  Branch.associate = (models) => {
    Branch.hasMany(models.Loan, { foreignKey: 'branchId', as: 'loans' });
  };

  return Branch;
};
