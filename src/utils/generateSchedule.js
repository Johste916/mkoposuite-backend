function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function generateFlatRateSchedule({ amount, interestRate, term, issueDate }) {
  const monthlyPrincipal = amount / term;
  const monthlyInterest = (amount * interestRate) / 100 / 12;
  const totalMonthly = monthlyPrincipal + monthlyInterest;

  const schedule = [];

  for (let i = 1; i <= term; i++) {
    const dueDate = addMonths(issueDate, i);
    schedule.push({
      installment: i,
      dueDate: dueDate.toISOString().split('T')[0],
      principal: monthlyPrincipal.toFixed(2),
      interest: monthlyInterest.toFixed(2),
      total: totalMonthly.toFixed(2),
      balance: (amount - monthlyPrincipal * i).toFixed(2),
    });
  }

  return schedule;
}

function generateReducingBalanceSchedule({ amount, interestRate, term, issueDate }) {
  const monthlyRate = interestRate / 100 / 12;
  const denominator = Math.pow(1 + monthlyRate, term) - 1;
  const emi = (amount * monthlyRate * Math.pow(1 + monthlyRate, term)) / denominator;

  const schedule = [];
  let balance = amount;

  for (let i = 1; i <= term; i++) {
    const interest = balance * monthlyRate;
    const principal = emi - interest;
    balance -= principal;

    const dueDate = addMonths(issueDate, i);

    schedule.push({
      installment: i,
      dueDate: dueDate.toISOString().split('T')[0],
      principal: principal.toFixed(2),
      interest: interest.toFixed(2),
      total: emi.toFixed(2),
      balance: balance > 0 ? balance.toFixed(2) : '0.00',
    });
  }

  return schedule;
}

module.exports = {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
};
