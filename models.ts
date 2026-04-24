import mongoose from 'mongoose';

// Map virtual _id to id so frontend is happy
const transformObjectId = {
  virtuals: true,
  versionKey: false,
  transform: function (doc: any, ret: any) {
    delete ret._id;
  }
};

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  full_name: { type: String, required: true },
  role: { type: String, enum: ['client', 'artisan', 'admin'], required: true },
  phone: { type: String, required: true },
  age: Number,
  is_verified_otp: { type: Boolean, default: false },
  otp_code: String,
  created_at: { type: Date, default: Date.now }
});
userSchema.set('toJSON', transformObjectId);

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  icon: { type: String, required: true }
});
categorySchema.set('toJSON', transformObjectId);

const artisanProfileSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  bio: String,
  lat: Number,
  lng: Number,
  service_radius_km: { type: Number, default: 20 },
  is_verified: { type: Number, default: 0 },
  verification_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  avg_rating: { type: Number, default: 0 },
  completed_jobs: { type: Number, default: 0 },
  is_online: { type: Number, default: 1 },
  contract_signed: { type: Boolean, default: false }
});
artisanProfileSchema.set('toJSON', transformObjectId);

// 2d sphere index for geo search distance calculation
artisanProfileSchema.index({ lat: 1, lng: 1 });

const artisanDocumentSchema = new mongoose.Schema({
  artisan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtisanProfile', required: true },
  doc_type: String,
  file_path: String,
  status: { type: String, default: 'pending' }
});
artisanDocumentSchema.set('toJSON', transformObjectId);

const serviceRequestSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  artisan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtisanProfile', required: true },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  description: String,
  status: { type: String, enum: ['pending', 'accepted', 'completed', 'cancelled'], default: 'pending' },
  lat: Number,
  lng: Number,
  rating: Number,
  review: String,
  scheduled_at: Date,
  created_at: { type: Date, default: Date.now }
});
serviceRequestSchema.set('toJSON', transformObjectId);

const artisanPhotoSchema = new mongoose.Schema({
  artisan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtisanProfile', required: true },
  file_path: String,
  description: String,
  created_at: { type: Date, default: Date.now }
});
artisanPhotoSchema.set('toJSON', transformObjectId);


const chatMessageSchema = new mongoose.Schema({
  room_id: { type: String, required: true }, // e.g. `${clientId}_${artisanProfileId}`
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});
chatMessageSchema.set('toJSON', transformObjectId);

export const User = mongoose.model('User', userSchema);
export const Category = mongoose.model('Category', categorySchema);
export const ArtisanProfile = mongoose.model('ArtisanProfile', artisanProfileSchema);
export const ArtisanDocument = mongoose.model('ArtisanDocument', artisanDocumentSchema);
export const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export const ArtisanPhoto = mongoose.model('ArtisanPhoto', artisanPhotoSchema);
export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
