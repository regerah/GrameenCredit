const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { sendOTP, verifyOTP } = require('../services/smsService');
const { encryptData, decryptData } = require('../utils/encryption');

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  phoneNumber: Joi.string().pattern(/^[6-9]\d{9}$/).required(),
  name: Joi.string().min(2).max(50).required(),
  aadhaarNumber: Joi.string().pattern(/^\d{12}$/).required(),
  panNumber: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).required(),
  preferredLanguage: Joi.string().valid('hindi', 'english', 'tamil', 'telugu', 'bengali', 'marathi', 'gujarati').default('hindi'),
  password: Joi.string().min(6).required(),
  deviceId: Joi.string().required(),
  address: Joi.object({
    village: Joi.string().required(),
    district: Joi.string().required(),
    state: Joi.string().required(),
    pincode: Joi.string().pattern(/^\d{6}$/).required()
  }).required(),
  occupation: Joi.string().valid('farmer', 'shopkeeper', 'gig_worker', 'self_employed', 'daily_wage', 'other').required(),
  monthlyIncome: Joi.number().min(0).required()
});

const loginSchema = Joi.object({
  phoneNumber: Joi.string().pattern(/^[6-9]\d{9}$/).required(),
  password: Joi.string().required(),
  deviceId: Joi.string().required()
});

const otpSchema = Joi.object({
  phoneNumber: Joi.string().pattern(/^[6-9]\d{9}$/).required(),
  otp: Joi.string().length(6).required()
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      phoneNumber,
      name,
      aadhaarNumber,
      panNumber,
      preferredLanguage,
      password,
      deviceId,
      address,
      occupation,
      monthlyIncome
    } = value;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { phoneNumber },
        { aadhaarNumber },
        { panNumber }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this phone number, Aadhaar, or PAN'
      });
    }

    // Create new user
    const user = new User({
      phoneNumber,
      name,
      aadhaarNumber: encryptData(aadhaarNumber),
      panNumber: encryptData(panNumber),
      preferredLanguage,
      password,
      deviceId,
      address,
      occupation,
      monthlyIncome
    });

    await user.save();

    // Send OTP for phone verification
    await sendOTP(phoneNumber);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your phone number with OTP.',
      data: {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        preferredLanguage: user.preferredLanguage
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { phoneNumber, password, deviceId } = value;

    // Find user
    const user = await User.findOne({ phoneNumber, isActive: true });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check device binding
    if (user.deviceId && user.deviceId !== deviceId) {
      return res.status(403).json({
        success: false,
        message: 'Device not authorized. Please contact support.',
        requiresDeviceVerification: true
      });
    }

    // Update device ID if not set
    if (!user.deviceId) {
      user.deviceId = deviceId;
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Send OTP for additional security
    await sendOTP(phoneNumber);

    res.json({
      success: true,
      message: 'Login successful. Please verify with OTP.',
      data: {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        preferredLanguage: user.preferredLanguage,
        requiresOTP: true
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Verify OTP and complete authentication
router.post('/verify-otp', async (req, res) => {
  try {
    const { error, value } = otpSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { phoneNumber, otp } = value;

    // Verify OTP
    const isOTPValid = await verifyOTP(phoneNumber, otp);
    if (!isOTPValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Find user
    const user = await User.findOne({ phoneNumber, isActive: true });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        preferredLanguage: user.preferredLanguage
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Authentication successful',
      data: {
        token,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          name: user.name,
          preferredLanguage: user.preferredLanguage,
          aadhaarVerified: user.aadhaarVerified,
          panVerified: user.panVerified,
          creditScore: user.creditScore,
          isEligibleForLoan: user.isEligibleForLoan()
        }
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || !/^[6-9]\d{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Valid phone number is required'
      });
    }

    // Check if user exists
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send OTP
    await sendOTP(phoneNumber);

    res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        preferredLanguage: user.preferredLanguage,
        address: user.address,
        occupation: user.occupation,
        monthlyIncome: user.monthlyIncome,
        aadhaarVerified: user.aadhaarVerified,
        panVerified: user.panVerified,
        creditScore: user.creditScore,
        riskCategory: user.riskCategory,
        voiceEnabled: user.voiceEnabled,
        voiceSpeed: user.voiceSpeed,
        totalLoansApplied: user.totalLoansApplied,
        totalLoansApproved: user.totalLoansApproved,
        currentLoanAmount: user.currentLoanAmount,
        isEligibleForLoan: user.isEligibleForLoan(),
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Logout user
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a production environment, you might want to blacklist the token
    // For now, we'll just return success as JWT tokens are stateless
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
