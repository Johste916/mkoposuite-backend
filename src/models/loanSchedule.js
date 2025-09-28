// src/models/loanSchedule.js
module.exports = (sequelize, DataTypes) => {
  const LoanSchedule = sequelize.define('LoanSchedule', {
    id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    loanId:          { type: DataTypes.INTEGER, allowNull: false, field: 'loan_id' },   // map if your FK is snake_case

    period:          { type: DataTypes.INTEGER, allowNull: false, field: 'period' },
    dueDate:         { type: DataTypes.DATEONLY, allowNull: false, field: 'due_date' }, // ← important

    principal:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'principal' },
    interest:        { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'interest' },
    fees:            { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'fees' },
    penalties:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'penalties' },

    total:           { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'total' },

    // If these exist in DB, map them; if not, leaving them mapped is harmless because
    // the controller now selects only existing columns.
    principalPaid:   { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'principal_paid' },
    interestPaid:    { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'interest_paid' },
    feesPaid:        { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'fees_paid' },
    penaltiesPaid:   { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'penalties_paid' },

    paid:            { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'paid' },

    status:          { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'upcoming', field: 'status' },
  }, {
    tableName: 'loan_schedules',
    schema: 'public',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['loan_id'] },
      { fields: ['period'] },
      { fields: ['due_date'] },
      { fields: ['status'] },
    ],
  });

  return LoanSchedule;
};
