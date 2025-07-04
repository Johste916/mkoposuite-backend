const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
  expiresIn: '1d'
});
