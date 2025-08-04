// models/loansetting.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const LoanSetting = sequelize.define('LoanSetting', {
    defaultInterestRate: DataTypes.FLOAT,
    defaultLoanTerm: DataTypes.INTEGER,
    maxLoanAmount: DataTypes.FLOAT,
    penaltyRate: DataTypes.FLOAT,
    gracePeriodDays: DataTypes.INTEGER,
    processingFee: DataTypes.FLOAT,
    requireCollateral: DataTypes.BOOLEAN
  }, {});
  return LoanSetting;
};
