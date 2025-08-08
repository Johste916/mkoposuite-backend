// src/controllers/reportController.js
const { Loan, LoanRepayment, SavingsTransaction, Borrower } = require('../models');
const { Op } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// 📊 Get summary report (totals)
exports.getSummary = async (_req, res) => {
  try {
    const [loanCount, totalLoanAmount] = await Promise.all([
      Loan.count(),
      Loan.sum('amount'),
    ]);

    const [totalRepayments, totalSavings, defaulterCount] = await Promise.all([
      // "paid" might be your settled status; adjust if your schema differs
      LoanRepayment.sum('total', { where: { status: 'paid' } }),
      SavingsTransaction.sum('amount'),
      // count installments overdue (dueDate < now && not paid)
      LoanRepayment.count({
        where: {
          status: { [Op.ne]: 'paid' },
          dueDate: { [Op.lt]: new Date() },
        },
      }),
    ]);

    res.json({
      loanCount: loanCount || 0,
      totalLoanAmount: Number(totalLoanAmount || 0),
      totalRepayments: Number(totalRepayments || 0),
      totalSavings: Number(totalSavings || 0),
      defaulterCount: defaulterCount || 0,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
};

// 📈 Monthly trends (amounts per month)
exports.getTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      loans: 0,
      repayments: 0,
    }));

    const [loans, repayments] = await Promise.all([
      Loan.findAll({ where: { createdAt: { [Op.between]: [start, end] } }, attributes: ['amount', 'createdAt'] }),
      LoanRepayment.findAll({ where: { createdAt: { [Op.between]: [start, end] } }, attributes: ['total', 'createdAt'] }),
    ]);

    loans.forEach(l => {
      const m = new Date(l.createdAt).getMonth(); // 0..11
      monthly[m].loans += Number(l.amount || 0);
    });

    repayments.forEach(r => {
      const m = new Date(r.createdAt).getMonth(); // 0..11
      monthly[m].repayments += Number(r.total || 0);
    });

    res.json(monthly);
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
};

// 📄 Export repayments to CSV
exports.exportCSV = async (_req, res) => {
  try {
    const rows = await LoanRepayment.findAll({
      include: [{
        model: Loan,
        attributes: ['id'],
        include: [{ model: Borrower, attributes: ['id', 'name'] }],
      }],
      order: [['dueDate', 'DESC']],
    });

    const data = rows.map(r => ({
      borrower: r.Loan?.Borrower?.name || '',
      loanId: r.loanId,
      installment: r.installmentNumber,
      dueDate: r.dueDate,
      total: Number(r.total || 0),
      balance: Number(r.balance || 0),
      status: r.status || '',
    }));

    const parser = new Parser();
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment('repayments.csv');
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'CSV export failed' });
  }
};

// 📄 Export repayments to PDF
exports.exportPDF = async (_req, res) => {
  try {
    const rows = await LoanRepayment.findAll({
      include: [{
        model: Loan,
        attributes: ['id'],
        include: [{ model: Borrower, attributes: ['id', 'name'] }],
      }],
      order: [['dueDate', 'DESC']],
    });

    const doc = new PDFDocument({ margin: 36 });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=repayments.pdf');
      res.send(pdf);
    });

    doc.fontSize(18).text('Loan Repayment Report', { align: 'center' }).moveDown();

    rows.forEach(r => {
      doc.fontSize(11).text(
        `Borrower: ${r.Loan?.Borrower?.name || 'N/A'} | Loan #${r.loanId} | Installment: ${r.installmentNumber} | Due: ${r.dueDate} | Total: ${Number(r.total || 0)} | Status: ${r.status || ''}`
      );
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
};
