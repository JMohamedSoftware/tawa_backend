import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User, ArtisanProfile } from '../models';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "";

async function approveArtisanByPhone(phone: string) {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB...");

    // Find the user by phone
    const user = await User.findOne({ phone: phone.trim() });
    if (!user) {
      console.error(`User with phone ${phone} not found.`);
      return;
    }

    // Find the artisan profile
    const profile = await ArtisanProfile.findOne({ user_id: user._id });
    if (!profile) {
      console.error(`Artisan profile for ${user.full_name} not found.`);
      return;
    }

    // Approve
    profile.verification_status = 'approved';
    profile.is_verified = 1;
    profile.contract_signed = true;
    await profile.save();

    console.log(`✅ Successfully approved artisan: ${user.full_name} (${phone})`);
    
  } catch (err) {
    console.error("Error approving artisan:", err);
  } finally {
    await mongoose.disconnect();
  }
}

const phoneArg = process.argv[2];
if (phoneArg) {
  approveArtisanByPhone(phoneArg);
} else {
  console.log("Usage: npx ts-node scripts/admin_tools.ts <phone_number>");
}
