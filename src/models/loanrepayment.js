// Compatibility shim: expose LoanPayment as LoanRepayment
module.exports = (sequelize, DataTypes) => {
  // Reuse the real LoanPayment model definition
  const defineLoanPayment = require("./LoanPayment");
  const LoanPayment = defineLoanPayment(sequelize, DataTypes);

  // Make it look/behave like "LoanRepayment" for code that expects that name.
  // (Sequelize uses the key from models/index.js, but keeping name helps debuggers.)
  try {
    Object.defineProperty(LoanPayment, "name", { value: "LoanRepayment" });
  } catch (_) {}
  return LoanPayment;
};
