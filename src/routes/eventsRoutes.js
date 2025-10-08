'use strict';
const express = require('express');
const router = express.Router();

const clients = new Set();

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now(), id: req.id })}\n\n`);

  const client = { id: req.id, res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
});

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const c of clients) { try { c.res.write(msg); } catch {} }
}

const events = {
  borrowerChanged: (id)      => broadcast('borrower.changed', { id }),
  loanChanged:     (id)      => broadcast('loan.changed', { id }),
  repaymentAdded:  (loanId)  => broadcast('repayment.created', { loanId }),
  savingsChanged:  (id)      => broadcast('savings.changed', { id }),
  reportReady:     (key,url) => broadcast('report.ready', { key, url }),
};

module.exports = { router, events };
