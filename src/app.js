const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ✅ Allow frontend origin
const allowedOrigins = ['https://fluffy-elf-b843d2.netlify.app'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed for this origin'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

app.use('/api', authRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Test route (optional)
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running locally ✅' });
});

// Fallback
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
