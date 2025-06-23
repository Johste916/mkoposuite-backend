const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config(); // ⬅️ Load .env early

const app = express();

// ✅ CORS with frontend URL from .env
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

app.use(express.json());

// 🔁 Import Routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const loanRoutes = require('./routes/loanRoutes');        // optional
const borrowerRoutes = require('./routes/borrowerRoutes'); // optional

// ✅ Mount Routes
app.use('/api/auth', authRoutes);               // POST /api/auth/login
app.use('/api/dashboard', dashboardRoutes);     // GET /api/dashboard/summary
app.use('/api/loans', loanRoutes);              // (if any)
app.use('/api/borrowers', borrowerRoutes);      // (if any)

// ✅ Health Check
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running ✅' });
});

// ❌ 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
