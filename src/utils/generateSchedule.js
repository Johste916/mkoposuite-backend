// utils/generateSchedule.js
// Assumptions:
// - interestRate is a MONTHLY percent (e.g., 10 means 10% per month)
// - term is in months
// - issueDate can be Date or "YYYY-MM-DD"

function round2(n) {
  const x = Number(n) || 0;
  return Math.round(x * 100) / 100;
}

function toDateOnly(input) {
  // Normalize any input to "YYYY-MM-DD"
  if (!input) return new Date().toISOString().slice(0, 10);
  const s = typeof input === "string" ? input.slice(0, 10) : new Date(input).toISOString().slice(0, 10);
  // s is already YYYY-MM-DD now
  return s;
}

// Month-end safe adder that returns "YYYY-MM-DD"
function addMonthsDateOnly(dateStr, months) {
  const [y, m, d] = String(toDateOnly(dateStr)).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + Number(months || 0), dt.getUTCDate()));
  // If we rolled to next month because original day doesn't exist (e.g., 31st),
  // back up to last day of previous month
  if (target.getUTCMonth() !== ((m - 1 + Number(months || 0)) % 12 + 12) % 12) {
    target.setUTCDate(0);
  }
  return target.toISOString().slice(0, 10);
}

/**
 * Flat-rate schedule:
 *  - monthlyInterest = P * (r/100)   // r is monthly percent
 *  - monthlyPrincipal = P / n
 *  - last period principal adjusted to clear rounding residue
 */
function generateFlatRateSchedule({ amount, interestRate, term, issueDate }) {
  const P = Number(amount) || 0;
  const n = Number(term) || 0;
  const r = Math.max(0, Number(interestRate) || 0) / 100; // monthly decimal
  if (P <= 0 || n <= 0) return [];

  const rows = [];
  const monthlyPrincipal = round2(P / n);
  const monthlyInterest = round2(P * r);

  let remaining = P;

  for (let i = 0; i < n; i++) {
    // Last period: absorb rounding so balance hits zero
    const principal = i === n - 1 ? round2(remaining) : monthlyPrincipal;
    const interest = monthlyInterest;
    const total = round2(principal + interest);
    remaining = round2(remaining - principal);

    rows.push({
      period: i + 1,
      // keep "installment" too for widest compatibility
      installment: i + 1,
      dueDate: addMonthsDateOnly(issueDate, i + 1),
      principal,
      interest,
      fees: 0,
      penalties: 0,
      total,
      balance: remaining,
      settled: false,
    });
  }

  return rows;
}

/**
 * Reducing-balance (amortized) schedule:
 *  - payment = P * r / (1 - (1 + r)^-n), where r is monthly decimal
 *  - interest_i = balance * r
 *  - principal_i = payment - interest_i
 *  - last period principal adjusted to clear rounding residue
 */
function generateReducingBalanceSchedule({ amount, interestRate, term, issueDate }) {
  const P = Number(amount) || 0;
  const n = Number(term) || 0;
  const r = Math.max(0, Number(interestRate) || 0) / 100; // monthly decimal
  if (P <= 0 || n <= 0) return [];

  const rows = [];
  let bal = P;

  const payment =
    r === 0
      ? round2(P / n)
      : round2((P * r) / (1 - Math.pow(1 + r, -n)));

  for (let i = 0; i < n; i++) {
    const interest = round2(bal * r);
    let principal = round2(payment - interest);

    // Last period cleanup to zero the balance
    if (i === n - 1) principal = round2(bal);

    const total = round2(principal + interest);
    bal = round2(bal - principal);

    rows.push({
      period: i + 1,
      installment: i + 1,
      dueDate: addMonthsDateOnly(issueDate, i + 1),
      principal,
      interest,
      fees: 0,
      penalties: 0,
      total,
      balance: bal,
      settled: false,
    });
  }

  return rows;
}

module.exports = {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
};
