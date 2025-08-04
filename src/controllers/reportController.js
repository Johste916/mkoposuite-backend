const { Loan, LoanRepayment, SavingsTransaction, Borrower } = require('../models');
const { Op } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// 📊 Get summary report (totals)
exports.getSummary = async (req, res) => {
  try {
    const [loanCount, totalLoanAmount] = await Promise.all([
      Loan.count(),
      Loan.sum('amount'),
    ]);

    const [totalRepayments, totalSavings, defaulterCount] = await Promise.all([
      LoanRepayment.sum('total', { where: { status: 'paid' } }),
      SavingsTransaction.sum('amount'),
      LoanRepayment.count({ where: { status: 'pending', dueDate: { [Op.lt]: new Date() } } }),
    ]);

    res.json({
      loanCount,
      totalLoanAmount,
      totalRepayments,
      totalSavings,
      defaulterCount,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
};

// 📈 Monthly trends
exports.getTrends = async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      loans: 0,
      repayments: 0,
    }));

    const loans = await Loan.findAll({
      where: {
        createdAt: {
          [Op.between]: [new Date(`${year}-01-01`), new Date(`${year}-12-31`)],
        },
      },
    });

    const repayments = await LoanRepayment.findAll({
      where: {
        createdAt: {
          [Op.between]: [new Date(`${year}-01-01`), new Date(`${year}-12-31`)],
        },
      },
    });

    loans.forEach((l) => {
      const month = new Date(l.createdAt).getMonth();
      monthlyData[month].loans += l.amount;
    });

    repayments.forEach((r) => {
      const month = new Date(r.createdAt).getMonth();
      monthlyData[month].repayments += parseFloat(r.total);
    });

    res.json(monthlyData);
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
};

// 📄 Export to CSV
exports.exportCSV = async (req, res) => {
  try {
    const repayments = await LoanRepayment.findAll({
      include: { all: true },
      order: [['dueDate', 'DESC']],
    });

    const data = repayments.map(r => ({
      borrower: r.Loan?.Borrower?.name || '',
      loanId: r.loanId,
      installment: r.installmentNumber,
      dueDate: r.dueDate,
      total: r.total,
      balance: r.balance,
      status: r.status,
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

// 📄 Export to PDF
exports.exportPDF = async (req, res) => {
  try {
    const repayments = await LoanRepayment.findAll({
      include: { all: true },
      order: [['dueDate', 'DESC']],
    });

    const doc = new PDFDocument();
    let buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=repayments.pdf');
      res.send(pdfData);
    });

    doc.fontSize(18).text('Loan Repayment Report', { align: 'center' }).moveDown();

    repayments.forEach(r => {
      doc.fontSize(12).text(
        `Borrower: ${r.Loan?.Borrower?.name || 'N/A'} | Loan #${r.loanId} | Installment: ${r.installmentNumber} | Due: ${r.dueDate} | Total: ${r.total} | Status: ${r.status}`
      );
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
};
