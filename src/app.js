const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Register routes
const authRoutes = require('./routes/authRoutes');
app.use('/api', authRoutes); // ✅ Gives access to /api/login and /api/test

// ✅ Catch-all 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
