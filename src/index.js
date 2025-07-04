// index.js
const app = require('./app');
const { sequelize } = require('./models'); // Adjust if your Sequelize models are in a different path

const PORT = process.env.PORT || 10000;

// Start the server only after DB is connected
sequelize.authenticate()
  .then(() => {
    console.log('✅ Connected to the database');
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Unable to connect to the database:', err);
  });
