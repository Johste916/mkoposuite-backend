const express = require('express');
const router = express.Router();

router.get('/borrower/:borrowerId', (req, res) => {
  res.json([]); // placeholder
});

router.post('/', (req, res) => {
  res.status(201).json({ id: Date.now(), ...req.body });
});

module.exports = router;
