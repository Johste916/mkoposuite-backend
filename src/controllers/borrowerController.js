// backend/src/controllers/borrowerController.js

const { Borrower } = require('../models');

exports.getAllBorrowers = async (req, res) => {
  try {
    const borrowers = await Borrower.findAll();
    res.status(200).json(borrowers);
  } catch (err) {
    console.error('Error fetching borrowers:', err);
    res.status(500).json({ error: 'Failed to fetch borrowers' });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    const newBorrower = await Borrower.create(req.body);
    res.status(201).json(newBorrower);
  } catch (err) {
    console.error('Error creating borrower:', err);
    res.status(400).json({ error: 'Failed to create borrower' });
  }
};

exports.updateBorrower = async (req, res) => {
  try {
    const borrower = await Borrower.findByPk(req.params.id);
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

    await borrower.update(req.body);
    res.json(borrower);
  } catch (err) {
    console.error('Error updating borrower:', err);
    res.status(500).json({ error: 'Failed to update borrower' });
  }
};

exports.deleteBorrower = async (req, res) => {
  try {
    const borrower = await Borrower.findByPk(req.params.id);
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

    await borrower.destroy();
    res.json({ message: 'Borrower deleted successfully' });
  } catch (err) {
    console.error('Error deleting borrower:', err);
    res.status(500).json({ error: 'Failed to delete borrower' });
  }
};
