import express from "express";
import path from "path";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import multer from "multer";
import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

import { User, Category, ArtisanProfile, ArtisanDocument, ServiceRequest, ArtisanPhoto, ChatMessage } from "./models.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "artisan-tn-secret-key-2026";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/harifi_db";

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log("Connected to MongoDB successfully!");
    // Seed Categories if empty
    const catCount = await Category.countDocuments();
    if (catCount === 0) {
      await Category.insertMany([
        { name: "سباك (بلومبي)", slug: "plumber", icon: "Droplets" },
        { name: "كهربائي", slug: "electrician", icon: "Zap" },
        { name: "نجار", slug: "carpenter", icon: "Hammer" },
        { name: "فني تكييف", slug: "ac-technician", icon: "Wind" },
        { name: "دهان (صباغ)", slug: "painter", icon: "Paintbrush" },
        { name: "بستاني", slug: "gardener", icon: "Leaf" }
      ]);
      console.log("Categories seeded!");
    }
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
  });

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
    try {
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ error: "User already exists" });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({ email, password: hashedPassword, full_name: fullName, role });

      if (role === 'artisan') {
        await ArtisanProfile.create({ user_id: user._id });
      }

      const token = jwt.sign({ id: user._id, email, role }, JWT_SECRET);
      res.json({ token, user: { id: user._id, email, fullName, role } });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email }) as any;
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = jwt.sign({ id: user._id, email, role: user.role }, JWT_SECRET);
      res.json({ token, user: { id: user._id, email, fullName: user.full_name, role: user.role } });
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/categories", async (req, res) => {
    const categories = await Category.find();
    res.json(categories);
  });

  app.get("/api/artisans/search", async (req, res) => {
    try {
      const { categorySlug, lat, lng, radiusKm = 50 } = req.query;
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);

      let query: any = { is_verified: 1 };
      
      if (categorySlug) {
        const cat = await Category.findOne({ slug: categorySlug as string });
        if (cat) query.category_id = cat._id;
      }

      const artisans = await ArtisanProfile.find(query).populate('user_id category_id');

      const results = artisans.map((doc: any) => {
        const a = doc.toJSON();
        const distance = getDistance(userLat, userLng, a.lat, a.lng);

        const distance_score = 1 / (1 + distance);
        const rating_score = a.avg_rating / 5;
        const jobs_score = Math.log(1 + a.completed_jobs) / Math.log(1 + 200);
        const verified_bonus = a.is_verified ? 0.1 : 0;
        const availability_bonus = a.is_online ? 0.05 : 0;

        const smart_score = (0.45 * distance_score) + (0.35 * rating_score) + (0.15 * jobs_score) + verified_bonus + availability_bonus;

        return { 
          ...a, 
          distance_km: distance.toFixed(2), 
          smart_score,
          full_name: (doc.user_id as any)?.full_name,
          email: (doc.user_id as any)?.email,
          category_name: (doc.category_id as any)?.name,
          category_slug: (doc.category_id as any)?.slug
        };
      })
      .filter(a => parseFloat(a.distance_km) <= parseFloat(radiusKm as string))
      .sort((a, b) => b.smart_score - a.smart_score);

      res.json(results);
    } catch (e) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/artisan/me", authenticate, async (req: any, res) => {
    const profile = await ArtisanProfile.findOne({ user_id: req.user.id }).populate('user_id category_id');
    if (!profile) return res.json(null);
    const data = profile.toJSON() as any;
    data.full_name = (profile.user_id as any)?.full_name;
    data.email = (profile.user_id as any)?.email;
    data.category_name = (profile.category_id as any)?.name;
    res.json(data);
  });

  app.put("/api/artisan/profile", authenticate, async (req: any, res) => {
    const { bio, category_id, lat, lng, service_radius_km } = req.body;
    await ArtisanProfile.findOneAndUpdate(
      { user_id: req.user.id },
      { bio, category_id: category_id || undefined, lat, lng, service_radius_km },
      { new: true }
    );
    res.json({ success: true });
  });

  app.post("/api/artisan/documents", authenticate, upload.single("document"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const profile = await ArtisanProfile.findOne({ user_id: req.user.id });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    await ArtisanDocument.create({
      artisan_id: profile._id,
      doc_type: req.body.doc_type,
      file_path: "/uploads/" + req.file.filename
    });
    res.json({ success: true });
  });

  app.get("/api/artisans/:id/photos", async (req, res) => {
    const photos = await ArtisanPhoto.find({ artisan_id: req.params.id }).sort({ created_at: -1 });
    res.json(photos);
  });

  app.post("/api/artisan/photos", authenticate, upload.single("photo"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const profile = await ArtisanProfile.findOne({ user_id: req.user.id });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    await ArtisanPhoto.create({
      artisan_id: profile._id,
      description: req.body.description,
      file_path: "/uploads/" + req.file.filename
    });
    res.json({ success: true });
  });

  // Admin Verification Queue
  app.get("/api/admin/pending-artisans", authenticate, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const pending = await ArtisanProfile.find({ verification_status: 'pending' }).populate('user_id category_id');
    
    const results = await Promise.all(pending.map(async (doc: any) => {
      const p = doc.toJSON();
      p.full_name = (doc.user_id as any)?.full_name;
      p.email = (doc.user_id as any)?.email;
      p.category_name = (doc.category_id as any)?.name;
      const docs = await ArtisanDocument.find({ artisan_id: doc._id });
      return { ...p, documents: docs };
    }));

    res.json(results);
  });

  app.post("/api/admin/verify", authenticate, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const { artisanId, status } = req.body;
    const isVerified = status === 'approved' ? 1 : 0;
    await ArtisanProfile.findByIdAndUpdate(artisanId, {
      verification_status: status,
      is_verified: isVerified
    });
    res.json({ success: true });
  });

  // Admin User Management
  app.get("/api/admin/users", authenticate, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const users = await User.find().select('-password');
    const mapped = users.map(u => {
      const j = u.toJSON() as any;
      j.fullName = j.full_name;
      return j;
    });
    res.json(mapped);
  });

  app.delete("/api/admin/users/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const userId = req.params.id;

    try {
      const artisanProfile = await ArtisanProfile.findOne({ user_id: userId });
      if (artisanProfile) {
        await ArtisanDocument.deleteMany({ artisan_id: artisanProfile._id });
        await ArtisanPhoto.deleteMany({ artisan_id: artisanProfile._id });
        await ServiceRequest.deleteMany({ artisan_id: artisanProfile._id });
        await ArtisanProfile.findByIdAndDelete(artisanProfile._id);
      }
      
      await ServiceRequest.deleteMany({ client_id: userId });
      await User.findByIdAndDelete(userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  // Service Requests
  app.post("/api/requests", authenticate, async (req: any, res) => {
    const { artisanId, categoryId, description, lat, lng } = req.body;
    try {
      const sr = await ServiceRequest.create({
        client_id: req.user.id,
        artisan_id: artisanId,
        category_id: categoryId,
        description, lat, lng
      });

      // Notify Artisan in real-time
      const profile = await ArtisanProfile.findById(artisanId);
      if (profile) {
        io.to(`user_${profile.user_id}`).emit("new_request", {
          description,
          lat, lng
        });
      }
      
      res.json({ success: true, request_id: sr._id });
    } catch(e) {
      res.status(500).json({ error: "Failed to create request "});
    }
  });

  app.get("/api/requests/client", authenticate, async (req: any, res) => {
    const requests = await ServiceRequest.find({ client_id: req.user.id }).populate('artisan_id category_id');
    const enriched = await Promise.all(requests.map(async (doc: any) => {
      const r = doc.toJSON();
      r.category_name = (doc.category_id as any)?.name;
      
      const artisan = doc.artisan_id;
      if (artisan && artisan.user_id) {
        const u = await User.findById(artisan.user_id);
        r.artisan_name = u?.full_name;
      }
      return r;
    }));
    res.json(enriched);
  });

  app.get("/api/requests/artisan", authenticate, async (req: any, res) => {
    const profile = await ArtisanProfile.findOne({ user_id: req.user.id });
    if (!profile) return res.json([]);

    const requests = await ServiceRequest.find({ artisan_id: profile._id }).populate('client_id category_id');
    const enriched = requests.map((doc: any) => {
      const r = doc.toJSON();
      r.category_name = (doc.category_id as any)?.name;
      r.client_name = (doc.client_id as any)?.full_name;
      return r;
    });
    
    res.json(enriched);
  });

  app.put("/api/requests/:id", authenticate, async (req: any, res) => {
    const { status } = req.body;
    const reqDoc = await ServiceRequest.findById(req.params.id);
    if (!reqDoc) return res.status(404).json({ error: "Not found" });

    // Ensure authorization
    reqDoc.status = status;
    await reqDoc.save();

    if (status === 'accepted') {
      io.to(`user_${reqDoc.client_id}`).emit("request_accepted", { request_id: reqDoc._id });
    }
    if (status === 'completed') {
      io.to(`user_${reqDoc.client_id}`).emit("request_completed", { request_id: reqDoc._id });
      // update completed jobs score
      await ArtisanProfile.findByIdAndUpdate(reqDoc.artisan_id, { $inc: { completed_jobs: 1 } });
    }

    res.json({ success: true });
  });

  // ─── Rating System ───────────────────────────────────────────────
  app.post("/api/requests/:id/rate", authenticate, async (req: any, res) => {
    const { rating, review } = req.body;
    const reqDoc = await ServiceRequest.findById(req.params.id) as any;
    if (!reqDoc) return res.status(404).json({ error: "Not found" });
    if (reqDoc.client_id.toString() !== req.user.id) return res.status(403).json({ error: "Forbidden" });
    if (reqDoc.status !== 'completed') return res.status(400).json({ error: "Can only rate completed requests" });

    reqDoc.rating = rating;
    reqDoc.review = review;
    await reqDoc.save();

    // Update artisan avg_rating
    const allRated = await ServiceRequest.find({ artisan_id: reqDoc.artisan_id, rating: { $exists: true, $ne: null } });
    const avg = allRated.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / allRated.length;
    await ArtisanProfile.findByIdAndUpdate(reqDoc.artisan_id, { avg_rating: Math.round(avg * 10) / 10 });

    res.json({ success: true });
  });

  // ─── Client Profile ───────────────────────────────────────────────
  app.get("/api/client/profile", authenticate, async (req: any, res) => {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  });

  app.put("/api/client/profile", authenticate, async (req: any, res) => {
    const { fullName, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id) as any;
    if (!user) return res.status(404).json({ error: "Not found" });

    if (fullName) user.full_name = fullName;

    if (currentPassword && newPassword) {
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(400).json({ error: "Current password incorrect" });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    res.json({ success: true, user: { id: user._id, email: user.email, fullName: user.full_name, role: user.role } });
  });

  // ─── Chat ─────────────────────────────────────────────────────────
  app.get("/api/chat/:artisanProfileId/:clientId", authenticate, async (req: any, res) => {
    const { artisanProfileId, clientId } = req.params;
    const roomId = `${clientId}_${artisanProfileId}`;
    
    const messages = await ChatMessage.find({ room_id: roomId })
      .populate('sender_id')
      .sort({ created_at: 1 });

    const enriched = messages.map((m: any) => ({
      ...m.toJSON(),
      sender_name: (m.sender_id as any)?.full_name,
      is_mine: (m.sender_id as any)?._id?.toString() === req.user.id
    }));

    res.json(enriched);
  });

  app.post("/api/chat/:artisanProfileId/:clientId", authenticate, async (req: any, res) => {
    const { message } = req.body;
    const { artisanProfileId, clientId } = req.params;
    const roomId = `${clientId}_${artisanProfileId}`;

    const profile = await ArtisanProfile.findById(artisanProfileId);
    if (!profile) return res.status(404).json({ error: "Artisan not found" });

    const msg = await ChatMessage.create({
      room_id: roomId,
      sender_id: req.user.id,
      message
    });

    // Notify the other party
    const recipientId = req.user.id === clientId ? profile.user_id : clientId;
    
    io.to(`user_${recipientId}`).emit("new_message", {
      room_id: roomId,
      message,
      sender_id: req.user.id,
      artisanProfileId,
      clientId
    });

    // Mirror to sender for multi-device sync
    io.to(`user_${req.user.id}`).emit("new_message", {
      room_id: roomId,
      message,
      sender_id: req.user.id,
      artisanProfileId,
      clientId
    });

    res.json({ success: true, messageId: msg._id });
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`API Server initialized - MongoDB Mode`);
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
