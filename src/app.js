const express = require('express');
const cors = require('cors');
const app = express(); // ✅ This was missing!

// Middleware
app.use(cors());
app.use(express.json());

// Route Imports
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

// Route Registrations
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

// Health Check
app.get('/api/test', (req, res) => {
  res.send('API is working!');
});

module.exports = app;
