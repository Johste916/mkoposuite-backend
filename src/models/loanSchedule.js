// models/loanschedule.js (or models/loanSchedule.js depending on your convention)
"use strict";

module.exports = (sequelize, DataTypes) => {
  const LoanSchedule = sequelize.define(
    "LoanSchedule",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      loanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "loan_id",
      },
      period: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "due_date",
      },
      principal: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      interest: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      fees: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      penalties: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },

      // paid breakdown
      principalPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: "principal_paid",
      },
      interestPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: "interest_paid",
      },
      feesPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: "fees_paid",
      },
      penaltiesPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: "penalties_paid",
      },

      paid: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "upcoming",
      },
    },
    {
      tableName: "loan_schedules",
      underscored: true,           // makes Sequelize expect snake_case DB fields
      createdAt: "created_at",     // map timestamps
      updatedAt: "updated_at",
    }
  );

  LoanSchedule.associate = (models) => {
    LoanSchedule.belongsTo(models.Loan, {
      foreignKey: "loanId", // model attr
      targetKey: "id",
      as: "loan",
    });
  };

  return LoanSchedule;
};
