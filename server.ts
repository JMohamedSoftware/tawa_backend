import express from "express";
// import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import multer from "multer";
import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";

const JWT_SECRET = process.env.JWT_SECRET || "artisan-tn-secret-key-2026";
const db = new Database("artisan.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    role TEXT CHECK(role IN ('client', 'artisan', 'admin')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    slug TEXT UNIQUE,
    icon TEXT
  );

  CREATE TABLE IF NOT EXISTS artisan_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    category_id INTEGER,
    bio TEXT,
    lat REAL,
    lng REAL,
    service_radius_km REAL DEFAULT 20,
    is_verified INTEGER DEFAULT 0,
    verification_status TEXT DEFAULT 'pending', -- pending, approved, rejected
    avg_rating REAL DEFAULT 0,
    completed_jobs INTEGER DEFAULT 0,
    is_online INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS artisan_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artisan_id INTEGER,
    doc_type TEXT,
    file_path TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(artisan_id) REFERENCES artisan_profiles(id)
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    artisan_id INTEGER,
    category_id INTEGER,
    description TEXT,
    status TEXT DEFAULT 'pending', -- pending, accepted, completed, cancelled
    lat REAL,
    lng REAL,
    rating INTEGER,
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES users(id),
    FOREIGN KEY(artisan_id) REFERENCES artisan_profiles(id)
  );

  CREATE TABLE IF NOT EXISTS artisan_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artisan_id INTEGER,
    file_path TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(artisan_id) REFERENCES artisan_profiles(id)
  );
`);

// Seed Categories if empty
const catCount = db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number };
if (catCount.count === 0) {
  const insertCat = db.prepare("INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)");
  const cats = [
    ["Plumber", "plumber", "Droplets"],
    ["Electrician", "electrician", "Zap"],
    ["Carpenter", "carpenter", "Hammer"],
    ["AC Technician", "ac-technician", "Wind"],
    ["Painter", "painter", "Paintbrush"],
    ["Gardener", "gardener", "Leaf"]
  ];
  cats.forEach(c => insertCat.run(c[0], c[1], c[2]));
}

// Helper: Haversine distance
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  // Socket Logic
  io.on("connection", (socket) => {
    socket.on("register", (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} registered for notifications`);
    });
  });

  app.use(cors());
  app.use(express.json());
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  if (!fs.existsSync(path.join(process.cwd(), "uploads"))) {
    fs.mkdirSync(path.join(process.cwd(), "uploads"));
  }

  const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
  });
  const upload = multer({ storage });

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // --- API Routes ---

  app.post("/api/auth/register", async (req, res) => {
    const { email, password, fullName, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const result = db.prepare("INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)").run(email, hashedPassword, fullName, role);
      const userId = result.lastInsertRowid;

      if (role === 'artisan') {
        db.prepare("INSERT INTO artisan_profiles (user_id) VALUES (?)").run(userId);
      }

      const token = jwt.sign({ id: userId, email, role }, JWT_SECRET);
      res.json({ token, user: { id: userId, email, fullName, role } });
    } catch (e: any) {
      res.status(400).json({ error: "User already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, email, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email, fullName: user.full_name, role: user.role } });
  });

  app.get("/api/categories", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories").all();
    res.json(categories);
  });

  app.get("/api/artisans/search", (req, res) => {
    const { categorySlug, lat, lng, radiusKm = 50 } = req.query;
    const userLat = parseFloat(lat as string);
    const userLng = parseFloat(lng as string);

    let query = `
      SELECT ap.*, u.full_name, c.name as category_name, c.slug as category_slug
      FROM artisan_profiles ap
      JOIN users u ON ap.user_id = u.id
      JOIN categories c ON ap.category_id = c.id
      WHERE ap.is_verified = 1
    `;
    const params: any[] = [];

    if (categorySlug) {
      query += " AND c.slug = ?";
      params.push(categorySlug);
    }

    const artisans = db.prepare(query).all(...params) as any[];

    const results = artisans.map(a => {
      const distance = getDistance(userLat, userLng, a.lat, a.lng);

      // Smart Ranking Formula
      const distance_score = 1 / (1 + distance);
      const rating_score = a.avg_rating / 5;
      const jobs_score = Math.log(1 + a.completed_jobs) / Math.log(1 + 200);
      const verified_bonus = a.is_verified ? 0.1 : 0;
      const availability_bonus = a.is_online ? 0.05 : 0;

      const smart_score = (0.45 * distance_score) + (0.35 * rating_score) + (0.15 * jobs_score) + verified_bonus + availability_bonus;

      return { ...a, distance_km: distance.toFixed(2), smart_score };
    })
      .filter(a => a.distance_km <= parseFloat(radiusKm as string))
      .sort((a, b) => b.smart_score - a.smart_score);

    res.json(results);
  });

  // Artisan Profile Management
  app.get("/api/artisan/me", authenticate, (req: any, res) => {
    const profile = db.prepare(`
      SELECT ap.*, u.full_name, u.email 
      FROM artisan_profiles ap 
      JOIN users u ON ap.user_id = u.id 
      WHERE u.id = ?
    `).get(req.user.id);
    res.json(profile);
  });

  app.put("/api/artisan/profile", authenticate, (req: any, res) => {
    const { bio, category_id, lat, lng, service_radius_km } = req.body;
    db.prepare(`
      UPDATE artisan_profiles 
      SET bio = ?, category_id = ?, lat = ?, lng = ?, service_radius_km = ?
      WHERE user_id = ?
    `).run(bio, category_id, lat, lng, service_radius_km, req.user.id);
    res.json({ success: true });
  });

  // Artisan Document Uploads
  app.post("/api/artisan/documents", authenticate, upload.single("document") as any, (req: any, res) => {
    if (req.user.role !== 'artisan') return res.status(403).json({ error: "Forbidden" });
    const { doc_type } = req.body;
    const filePath = "/uploads/" + req.file.filename;

    const profile = db.prepare("SELECT id FROM artisan_profiles WHERE user_id = ?").get(req.user.id) as { id: number };

    db.prepare("INSERT INTO artisan_documents (artisan_id, doc_type, file_path) VALUES (?, ?, ?)")
      .run(profile.id, doc_type, filePath);

    res.json({ success: true, filePath });
  });

  // Admin Verification Queue
  app.get("/api/admin/pending-artisans", authenticate, (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const pending = db.prepare(`
      SELECT ap.*, u.full_name, u.email 
      FROM artisan_profiles ap 
      JOIN users u ON ap.user_id = u.id 
      WHERE ap.verification_status = 'pending'
    `).all() as any[];

    // Add documents to each pending artisan
    const withDocs = pending.map(p => {
      const docs = db.prepare("SELECT * FROM artisan_documents WHERE artisan_id = ?").all(p.id);
      return { ...p, documents: docs };
    });

    res.json(withDocs);
  });

  app.post("/api/admin/verify", authenticate, (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const { artisanId, status } = req.body;
    const isVerified = status === 'approved' ? 1 : 0;
    db.prepare("UPDATE artisan_profiles SET verification_status = ?, is_verified = ? WHERE id = ?")
      .run(status, isVerified, artisanId);
    res.json({ success: true });
  });

  // Service Requests
  app.post("/api/requests", authenticate, (req: any, res) => {
    const { artisanId, categoryId, description, lat, lng } = req.body;
    db.prepare(`
      INSERT INTO service_requests (client_id, artisan_id, category_id, description, lat, lng)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, artisanId, categoryId, description, lat, lng);

    // Notify Artisan in real-time
    io.to(`user_${artisanId}`).emit("new_request", {
      description,
      client_id: req.user.id
    });

    res.json({ success: true });
  });

  app.get("/api/requests/client", authenticate, (req: any, res) => {
    const requests = db.prepare(`
      SELECT sr.*, u.full_name as artisan_name, c.name as category_name
      FROM service_requests sr
      JOIN artisan_profiles ap ON sr.artisan_id = ap.id
      JOIN users u ON ap.user_id = u.id
      JOIN categories c ON sr.category_id = c.id
      WHERE sr.client_id = ?
    `).all(req.user.id);
    res.json(requests);
  });

  app.get("/api/requests/artisan", authenticate, (req: any, res) => {
    const requests = db.prepare(`
      SELECT sr.*, u.full_name as client_name, c.name as category_name
      FROM service_requests sr
      JOIN users u ON sr.client_id = u.id
      JOIN artisan_profiles ap ON sr.artisan_id = ap.id
      JOIN categories c ON sr.category_id = c.id
      WHERE ap.user_id = ?
    `).all(req.user.id);
    res.json(requests);
  });

  // Artisan Portfolio Photos
  app.post("/api/artisan/photos", authenticate, upload.single("photo") as any, (req: any, res) => {
    if (req.user.role !== 'artisan') return res.status(403).json({ error: "Forbidden" });
    const { description } = req.body;
    const filePath = "/uploads/" + req.file.filename;

    const profile = db.prepare("SELECT id FROM artisan_profiles WHERE user_id = ?").get(req.user.id) as { id: number };

    db.prepare("INSERT INTO artisan_photos (artisan_id, file_path, description) VALUES (?, ?, ?)")
      .run(profile.id, filePath, description);

    res.json({ success: true, filePath });
  });

  app.get("/api/artisans/:id/photos", (req, res) => {
    const photos = db.prepare("SELECT * FROM artisan_photos WHERE artisan_id = ? ORDER BY created_at DESC").all(req.params.id);
    res.json(photos);
  });

  // Service Request Lifecycle
  app.patch("/api/requests/:id", authenticate, (req: any, res) => {
    const { status } = req.body;
    const { id } = req.params;

    // TODO: Add ownership check (artisan or client)
    db.prepare("UPDATE service_requests SET status = ? WHERE id = ?").run(status, id);

    // If completed, maybe update artisan stats
    if (status === 'completed') {
      const request = db.prepare("SELECT artisan_id, client_id FROM service_requests WHERE id = ?").get(id) as { artisan_id: number, client_id: number };
      db.prepare("UPDATE artisan_profiles SET completed_jobs = completed_jobs + 1 WHERE id = ?").run(request.artisan_id);

      // Notify Client
      io.to(`user_${request.client_id}`).emit("request_completed", { requestId: id });
    }

    if (status === 'accepted') {
      const request = db.prepare("SELECT client_id FROM service_requests WHERE id = ?").get(id) as { client_id: number };
      // Notify Client
      io.to(`user_${request.client_id}`).emit("request_accepted", { requestId: id });
    }

    res.json({ success: true });
  });

  app.post("/api/requests/:id/rate", authenticate, (req: any, res) => {
    const { rating, review } = req.body;
    const { id } = req.params;

    db.prepare("UPDATE service_requests SET rating = ?, review = ?, status = 'completed' WHERE id = ?").run(rating, review, id);

    // Update artisan average rating
    const request = db.prepare("SELECT artisan_id FROM service_requests WHERE id = ?").get(id) as { artisan_id: number };
    const avg = db.prepare("SELECT AVG(rating) as avg FROM service_requests WHERE artisan_id = ? AND rating IS NOT NULL").get(request.artisan_id) as { avg: number };
    db.prepare("UPDATE artisan_profiles SET avg_rating = ? WHERE id = ?").run(avg.avg, request.artisan_id);

    res.json({ success: true });
  });

  // API is ready
  console.log("API Server initialized");

  const PORT = 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
