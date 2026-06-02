function requireSuperAuth(req, res, next) {
  if (!req.session.isSuperAdmin) {
    return res.redirect('/superadmin/login');
  }
  next();
}

module.exports = { requireSuperAuth };
