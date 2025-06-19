exports.exportDefaulters = async (req, res) => {
    try {
      const { Loan, User, LoanRepayment } = require('../models');
  
      const defaulters = await LoanRepayment.findAll({
        where: { status: 'overdue' },
        include: [
          {
            model: Loan,
            as: 'loan',
            include: [{ model: User, as: 'user' }]
          }
        ]
      });
  
      const formatted = defaulters.map(d => ({
        RepaymentID: d.id,
        DueDate: d.dueDate,
        Borrower: d.loan?.user?.name || 'N/A',
        LoanID: d.loan?.id,
        Status: d.status
      }));
  
      const { format } = req.params;
  
      if (format === 'csv') {
        const { Parser } = require('json2csv');
        const parser = new Parser();
        const csv = parser.parse(formatted);
  
        res.header('Content-Type', 'text/csv');
        res.attachment('defaulters.csv');
        return res.send(csv);
      } else if (format === 'pdf') {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          res
            .writeHead(200, {
              'Content-Length': Buffer.byteLength(pdfData),
              'Content-Type': 'application/pdf',
              'Content-Disposition': 'attachment;filename=defaulters.pdf',
            })
            .end(pdfData);
        });
  
        doc.fontSize(16).text('Loan Defaulters Report', { align: 'center' });
        doc.moveDown();
  
        formatted.forEach((d, i) => {
          doc
            .fontSize(12)
            .text(
              `${i + 1}. ${d.Borrower} | Loan ID: ${d.LoanID} | Due: ${moment(d.DueDate).format('YYYY-MM-DD')}`
            );
        });
  
        doc.end();
      } else {
        res.status(400).json({ error: 'Invalid format. Use pdf or csv.' });
      }
    } catch (err) {
      console.error('Export defaulters error:', err);
      res.status(500).json({ error: 'Failed to export defaulters' });
    }
  };
  