import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { User, Category, ArtisanProfile } from "../models";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/tawa_db";

const tunisianNames = [
  "أحمد بن يوسف", "محمد صالح", "طارق الجبالي", "علي بن عمار", "وليد الطرابلسي",
  "خليل بوعزيز", "سامي الماجري", "ياسين النفزي", "كريم الساحلي", "رمزي العياري"
];

const tunisLocations = [
  { lat: 36.8065, lng: 10.1815 }, // Tunis Centre
  { lat: 36.8481, lng: 10.1658 }, // Ariana
  { lat: 36.7583, lng: 10.2311 }, // Ben Arous
  { lat: 36.8123, lng: 10.1005 }, // Manouba
  { lat: 36.8521, lng: 10.3233 }, // La Marsa
  { lat: 36.8373, lng: 10.2384 }, // Lac 2
  { lat: 36.8252, lng: 10.1654 }, // Bardo
  { lat: 36.7871, lng: 10.1837 }, // Medjez
  { lat: 36.8302, lng: 10.1340 }, // Omrane
  { lat: 36.8205, lng: 10.2325 }  // Lac 1
];

async function seed() {
  try {
    console.log("Connecting to:", MONGO_URI);
    await mongoose.connect(MONGO_URI);
    console.log("Connected successfully.");

    const categories = await Category.find();
    if (categories.length === 0) {
      console.log("No categories found. Start backend server once to seed categories.");
      process.exit(1);
    }

    let addedCount = 0;
    const passwordHash = await bcrypt.hash("123456", 10);

    for (let i = 0; i < 10; i++) {
      const email = `artisan${Math.floor(Math.random() * 10000)}@test.com`;
      const randomCategory = categories[Math.floor(Math.random() * categories.length)];
      const loc = tunisLocations[i];

      const user = await User.create({
        email,
        password: passwordHash,
        full_name: tunisianNames[i],
        role: "artisan",
        phone: "5" + Math.floor(1000000 + Math.random() * 8000000),
        is_verified_otp: true,
      });

      await ArtisanProfile.create({
        user_id: user._id,
        category_id: randomCategory._id,
        bio: `حرفي محترف ومتخصص في ${randomCategory.name}. أقدم خدمات سريعة ومضمونة.`,
        lat: loc.lat,
        lng: loc.lng,
        service_radius_km: 20 + Math.floor(Math.random() * 30),
        is_verified: 1,
        verification_status: "approved",
        avg_rating: 4 + Math.random(),
        completed_jobs: 5 + Math.floor(Math.random() * 50),
        is_online: 1,
        contract_signed: true,
      });

      addedCount++;
      console.log(`Added artisan: ${tunisianNames[i]} (${randomCategory.name})`);
    }

    console.log(`\n✅ Successfully seeded ${addedCount} artisans!`);
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Error seeding:", error);
    process.exit(1);
  }
}

seed();
