// src/app.js

const express = require('express');
const app = express();
const path = require('path');

// ✅ Robust CORS Setup
const allowedOrigins = [
  'http://localhost:5173',
  'https://strong-fudge-7fc28d.netlify.app',
  'https://mkoposuite.netlify.app', // optional: production domain
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // ✅ Required for dynamic origin
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200); // ✅ Preflight OK
  }

  next();
});

app.use(express.json());

// ✅ Route Imports
const authRoutes = require('./routes/authRoutes');
const borrowerRoutes = require('./routes/borrowerRoutes');
const loanRoutes = require('./routes/loanRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const savingsRoutes = require('./routes/savingsRoutes');
const disbursementRoutes = require('./routes/loanDisbursementRoutes');
const repaymentRoutes = require('./routes/repaymentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const settingRoutes = require('./routes/settingRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const branchRoutes = require('./routes/branchRoutes');
const userRoleRoutes = require('./routes/userRoleRoutes');
const userBranchRoutes = require('./routes/userBranchRoutes');

// ✅ Route Registrations
app.use('/api/login', authRoutes);
app.use('/api/borrowers', borrowerRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/disbursements', disbursementRoutes);
app.use('/api/repayments', repaymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/user-roles', userRoleRoutes);
app.use('/api/user-branches', userBranchRoutes);

// ✅ Health Check Route
app.get('/api/test', (req, res) => {
  res.send('✅ API is working!');
});

module.exports = app;