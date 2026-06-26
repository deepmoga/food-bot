const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'foodbot-app-secret-key-2024';

function generateToken(vendor) {
  return jwt.sign(
    { id: vendor.id, name: vendor.name, email: vendor.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.vendorId = decoded.id;
    req.vendorName = decoded.name;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { generateToken, authMiddleware, JWT_SECRET };
