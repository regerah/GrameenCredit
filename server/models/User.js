const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic Information
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^[6-9]\d{9}$/
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  preferredLanguage: {
    type: String,
    enum: ['hindi', 'english', 'tamil', 'telugu', 'bengali', 'marathi', 'gujarati'],
    default: 'hindi'
  },
  
  // Identity Verification
  aadhaarNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{12}$/
  },
  panNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
  },
  aadhaarVerified: {
    type: Boolean,
    default: false
  },
  panVerified: {
    type: Boolean,
    default: false
  },
  
  // Location Information
  address: {
    village: String,
    district: String,
    state: String,
    pincode: {
      type: String,
      match: /^\d{6}$/
    }
  },
  
  // Profile Information
  occupation: {
    type: String,
    enum: ['farmer', 'shopkeeper', 'gig_worker', 'self_employed', 'daily_wage', 'other']
  },
  monthlyIncome: {
    type: Number,
    min: 0
  },
  
  // Digital Footprint Consent
  smsAnalysisConsent: {
    type: Boolean,
    default: false
  },
  upiAnalysisConsent: {
    type: Boolean,
    default: false
  },
  consentTimestamp: Date,
  
  // Credit Information
  creditScore: {
    type: Number,
    min: 300,
    max: 900
  },
  creditScoreLastUpdated: Date,
  
  // Authentication
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  deviceId: String,
  lastLogin: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Voice Preferences
  voiceEnabled: {
    type: Boolean,
    default: true
  },
  voiceSpeed: {
    type: Number,
    min: 0.5,
    max: 2.0,
    default: 1.0
  },
  
  // Loan History
  totalLoansApplied: {
    type: Number,
    default: 0
  },
  totalLoansApproved: {
    type: Number,
    default: 0
  },
  currentLoanAmount: {
    type: Number,
    default: 0
  },
  
  // Risk Assessment
  riskCategory: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  fraudFlags: [{
    type: String,
    timestamp: Date
  }]
}, {
  timestamps: true
});

// Index for faster queries
userSchema.index({ phoneNumber: 1 });
userSchema.index({ aadhaarNumber: 1 });
userSchema.index({ panNumber: 1 });
userSchema.index({ 'address.pincode': 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get user's full name with preferred language
userSchema.methods.getDisplayName = function() {
  return this.name;
};

// Check if user is eligible for loan
userSchema.methods.isEligibleForLoan = function() {
  return this.aadhaarVerified && 
         this.panVerified && 
         this.currentLoanAmount === 0 && 
         this.isActive;
};

// Get risk assessment
userSchema.methods.getRiskAssessment = function() {
  let score = 0;
  
  // Positive factors
  if (this.aadhaarVerified) score += 10;
  if (this.panVerified) score += 10;
  if (this.smsAnalysisConsent) score += 15;
  if (this.upiAnalysisConsent) score += 15;
  if (this.monthlyIncome > 10000) score += 20;
  if (this.totalLoansApproved > 0) score += 25;
  
  // Negative factors
  if (this.fraudFlags.length > 0) score -= 30;
  if (this.currentLoanAmount > 0) score -= 20;
  
  if (score >= 60) return 'low';
  if (score >= 30) return 'medium';
  return 'high';
};

module.exports = mongoose.model('User', userSchema);
