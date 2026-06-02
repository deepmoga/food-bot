function requireAuth(req, res, next) {
  if (!req.session.vendorId) {
    return res.redirect('/admin/login');
  }
  res.locals.vendorId = req.session.vendorId;
  res.locals.vendorName = req.session.vendorName;
  next();
}

module.exports = { requireAuth };
