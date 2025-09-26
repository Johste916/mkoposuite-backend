// src/models/loanSchedule.js
module.exports = (sequelize, DataTypes) => {
  const LoanSchedule = sequelize.define('LoanSchedule', {
    id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    loanId:        { type: DataTypes.INTEGER, allowNull: false },
    period:        { type: DataTypes.INTEGER, allowNull: false }, // 1..N
    dueDate:       { type: DataTypes.DATEONLY, allowNull: false },
    principal:     { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    interest:      { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    fees:          { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    penalties:     { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    total:         { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'loan_schedules',
    schema: 'public',
    timestamps: true,
    underscored: false,
  });

  return LoanSchedule;
};
