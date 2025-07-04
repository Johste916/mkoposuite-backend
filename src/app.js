// src/app.js

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const app = express();

// Load environment variables from .env file
dotenv.config();

// Middlewares
app.use(cors());
app.use(express.json());

// Test endpoint to confirm API is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working ✅' });
});

// Import routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
// Uncomment the routes below only if the files exist
// const loanRoutes = require('./routes/loanRoutes');
// const borrowerRoutes = require('./routes/borrowerRoutes');
// const repaymentRoutes = require('./routes/repaymentRoutes');
// const userRoutes = require('./routes/userRoutes');

// Mount routes under /api
app.use('/api', authRoutes);
app.use('/api', dashboardRoutes);
// Uncomment if routes exist
// app.use('/api', loanRoutes);
// app.use('/api', borrowerRoutes);
// app.use('/api', repaymentRoutes);
// app.use('/api', userRoutes);

module.exports = app;

