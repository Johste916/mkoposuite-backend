'use strict';
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../models');

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const Borrower = sequelize.models.Borrower;
  if (!Borrower) return res.json([]);

  const where = {};
  if (q) {
    const like = { [Op.iLike]: `%${q}%` };
    const idNumber = Number(q);
    where[Op.or] = [
      { name: like },
      { phone: like },
      ...(Number.isFinite(idNumber) ? [{ id: idNumber }] : []),
    ];
  }

  const rows = await Borrower.findAll({
    where,
    order: [['name', 'ASC']],
    limit: 20,
    attributes: ['id','name','phone'],
  });

  res.json(rows);
});

module.exports = router;
