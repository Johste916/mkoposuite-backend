exports.calcDailyPenalty = ({ overdueAmount, dailyRate = 0.001 }) => {
  const amt = Number(overdueAmount || 0);
  return Math.max(0, +(amt * dailyRate).toFixed(2));
};
