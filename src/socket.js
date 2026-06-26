const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./api/middleware');

let ioInstance = null;

function setupSocket(server) {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });
  ioInstance = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token required'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.vendorId = decoded.id;
      socket.vendorName = decoded.name;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const room = `vendor_${socket.vendorId}`;
    socket.join(room);
    console.log(`[Socket] Vendor ${socket.vendorId} connected (${socket.id})`);

    socket.on('disconnect', () => {
      console.log(`[Socket] Vendor ${socket.vendorId} disconnected`);
    });
  });

  return io;
}

module.exports = { setupSocket, get io() { return ioInstance; } };
