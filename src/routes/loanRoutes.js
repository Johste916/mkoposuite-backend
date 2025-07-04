const express = require('express');
const router = express.Router();

// Test route
router.get('/loans', (req, res) => {
  res.json({ message: 'Loan route is working ✅' });
});

module.exports = router;
