// …top omitted (same as you sent) …

exports.login = async (req, res) => {
  const emailIn = String(req.body?.email || '');
  const password = req.body?.password;
  if (!emailIn || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });
  }

  try {
    const rows = await sequelize.query(
      `SELECT *
         FROM "Users"
        WHERE LOWER(email) = LOWER(:email)
        LIMIT 1`,
      { replacements: { email: emailIn }, type: QueryTypes.SELECT }
    );

    const user = rows && rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const stored = extractStoredHash(user);
    let ok = false;
    if (stored) {
      if (isScryptHash(stored)) ok = verifyScryptHash(stored, password);
      else ok = await bcrypt.compare(String(password), String(stored));
    }
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const tenantId = await findTenantIdForUser(user.id);
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      tenantId,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId },
    });
  } catch (error) {
    console.error('Login error:', error);
    const pg = error?.original?.code || error?.parent?.code;
    if (pg === '42P01') {
      return res.status(500).json({
        message: 'Users table missing. Run DB migrations (e.g. `npx sequelize-cli db:migrate`).',
      });
    }
    if (pg === '42703') {
      return res.status(500).json({
        message: 'A required column is missing on Users. Ensure migrations are up to date.',
      });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};
