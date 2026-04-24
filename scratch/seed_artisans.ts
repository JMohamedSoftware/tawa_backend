
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { User, Category, ArtisanProfile } from '../models.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/tawa_db";

async function seed() {
    console.log("🌱 Seeding premium artisans...");
    await mongoose.connect(MONGO_URI);

    const categoriesCount = await Category.countDocuments();
    if (categoriesCount === 0) {
        console.log("📦 Initializing default categories...");
        const defaultCats = [
            { name: 'سباكة (Plomberie)', slug: 'plumbing', icon: 'Droplets' },
            { name: 'كهرباء (Électricité)', slug: 'electricity', icon: 'Zap' },
            { name: 'نجارة (Menuiserie)', slug: 'carpentry', icon: 'Hammer' },
            { name: 'دهان (Peinture)', slug: 'painting', icon: 'Paintbrush' },
            { name: 'تكييف (Climatisation)', slug: 'hvac', icon: 'Wind' }
        ];
        await Category.insertMany(defaultCats);
    }
    const categories = await Category.find();

    const mockArtisans = [
        { name: "أحمد بن سالم", email: "ahmed@tawa.tn", cat: "plumbing", bio: "سباك محترف بخبرة 15 سنة في تونس الكبرى. تخصص تركيب وصيانة الأنابيب.", rating: 4.8, jobs: 120 },
        { name: "منجي النجّار", email: "monji@tawa.tn", cat: "carpentry", bio: "نجارة عصرية وتقليدية. تصميم غرف نوم ومطابخ بجودة عالية.", rating: 4.9, jobs: 85 },
        { name: "صلاح الكهربائي", email: "salah@tawa.tn", cat: "electricity", bio: "كهربائي معتمد. صيانة الأعطال المنزلية وتركيب الأنظمة الذكية.", rating: 4.7, jobs: 64 },
        { name: "لطفي الدهّان", email: "lotfi@tawa.tn", cat: "painting", bio: "دهان ديكور بخبرة عالمية. أحدث الصيحات في عالم الدهانات والورنيش.", rating: 4.6, jobs: 210 },
        { name: "فوزي المكيفات", email: "fawzi@tawa.tn", cat: "hvac", bio: "خبير صيانة وتركيب مكيفات الهواء بجميع أنواعها. سرعة وإتقان.", rating: 5.0, jobs: 45 }
    ];

    const password = await bcrypt.hash("password123", 10);

    for (const art of mockArtisans) {
        // Create User
        let user = await User.findOne({ email: art.email });
        if (!user) {
            user = await User.create({
                full_name: art.name,
                email: art.email,
                password: password,
                role: 'artisan'
            });
        }

        const category = categories.find(c => c.slug === art.cat) || categories[0];

        // Create Profile
        await ArtisanProfile.findOneAndUpdate(
            { user_id: user._id },
            {
                category_id: category._id,
                bio: art.bio,
                avg_rating: art.rating,
                completed_jobs: art.jobs,
                is_verified: 1,
                verification_status: 'approved',
                is_online: 1,
                lat: 36.8065 + (Math.random() - 0.5) * 0.1,
                lng: 10.1815 + (Math.random() - 0.5) * 0.1
            },
            { upsert: true, new: true }
        );
        console.log(`✅ Added Artisan: ${art.name}`);
    }

    console.log("✨ Seeding completed! Your marketplace is now full of life.");
    await mongoose.disconnect();
}

seed().catch(err => console.error(err));
