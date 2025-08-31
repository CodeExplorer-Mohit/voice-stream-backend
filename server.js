import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Ensure recordings folder + index.json exists
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir);
}

const indexPath = path.join(recordingsDir, 'index.json');
if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, '[]');
}


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// app.use(cors());
app.use(cors({
  origin: "*", // ya agar sirf Netlify allow karna hai to:
  // origin: "https://iridescent-lolly-f900c3.netlify.app"
}));
app.use(express.json());
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'supersecrettoken123';

// --- Simple auth middleware for admin-only endpoints ---
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Multer storage for uploaded recordings ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'recordings'));
  },
  filename: function (req, file, cb) {
    // Save as <timestamp>.webm
    const ts = Date.now();
    cb(null, ts + '.webm');
  }
});
const upload = multer({ storage });

// Upload endpoint (admin uploads recorded blob here)
app.post('/api/upload', requireAdmin, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const meta = {
    id: path.parse(req.file.filename).name,
    filename: req.file.filename,
    size: req.file.size,
    createdAt: new Date().toISOString()
  };
  // append meta to a JSON index
  const indexPath = path.join(__dirname, 'recordings', 'index.json');
  let list = [];
  if (fs.existsSync(indexPath)) {
    try { list = JSON.parse(fs.readFileSync(indexPath, 'utf8') || '[]'); } catch {}
  }
  list.unshift(meta);
  fs.writeFileSync(indexPath, JSON.stringify(list, null, 2));
  res.json({ ok: true, meta });
});

// List recordings (admin)
app.get('/api/recordings', requireAdmin, (req, res) => {
  const indexPath = path.join(__dirname, 'recordings', 'index.json');
  if (!fs.existsSync(indexPath)) return res.json([]);
  try {
    const list = JSON.parse(fs.readFileSync(indexPath, 'utf8') || '[]');
    res.json(list);
  } catch(e) {
    res.json([]);
  }
});

// --- Socket.IO signaling for a single "room" ---
const ROOM = 'default-room';

io.on('connection', (socket) => {
  // Identify role
  socket.on('role', (role) => {
    socket.data.role = role;
    socket.join(ROOM);
    io.to(ROOM).emit('presence', { role, count: io.sockets.adapter.rooms.get(ROOM)?.size || 0 });
  });

  // Relay SDP and ICE candidates
  socket.on('webrtc-offer', (msg) => socket.to(ROOM).emit('webrtc-offer', msg));
  socket.on('webrtc-answer', (msg) => socket.to(ROOM).emit('webrtc-answer', msg));
  socket.on('webrtc-ice', (msg) => socket.to(ROOM).emit('webrtc-ice', msg));

  socket.on('disconnect', () => {
    io.to(ROOM).emit('peer-disconnected', { role: socket.data.role || 'unknown' });
  });
});

server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
