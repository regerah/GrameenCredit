const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const { encryptData, decryptData } = require('../utils/encryption');

const router = express.Router();

// Configure multer for profile image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit for profile images
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Validation schemas
const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(50).optional(),
  preferredLanguage: Joi.string().valid('hindi', 'english', 'tamil', 'telugu', 'bengali', 'marathi', 'gujarati').optional(),
  address: Joi.object({
    village: Joi.string().optional(),
    district: Joi.string().optional(),
    state: Joi.string().optional(),
    pincode: Joi.string().pattern(/^\d{6}$/).optional()
  }).optional(),
  occupation: Joi.string().valid('farmer', 'shopkeeper', 'gig_worker', 'self_employed', 'daily_wage', 'other').optional(),
  monthlyIncome: Joi.number().min(0).optional(),
  voiceEnabled: Joi.boolean().optional(),
  voiceSpeed: Joi.number().min(0.5).max(2.0).optional()
});

const verificationSchema = Joi.object({
  aadhaarNumber: Joi.string().pattern(/^\d{12}$/).optional(),
  panNumber: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional(),
  documentImage: Joi.string().optional() // Base64 encoded image
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = { ...value };
    
    // Update user profile
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        preferredLanguage: user.preferredLanguage,
        address: user.address,
        occupation: user.occupation,
        monthlyIncome: user.monthlyIncome,
        voiceEnabled: user.voiceEnabled,
        voiceSpeed: user.voiceSpeed,
        aadhaarVerified: user.aadhaarVerified,
        panVerified: user.panVerified,
        creditScore: user.creditScore,
        riskCategory: user.riskCategory,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Upload profile image
router.post('/profile-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Profile image is required'
      });
    }

    // In production, upload to cloud storage (AWS S3, Google Cloud Storage, etc.)
    const filename = `profile_${req.user.userId}_${Date.now()}.${req.file.originalname.split('.').pop()}`;
    
    // For now, just store the filename in user profile
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { profileImage: filename },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        profileImage: filename,
        uploadDate: new Date()
      }
    });

  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Verify Aadhaar (mock implementation)
router.post('/verify-aadhaar', authenticateToken, async (req, res) => {
  try {
    const { error, value } = verificationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { aadhaarNumber, documentImage } = value;
    
    if (!aadhaarNumber) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar number is required'
      });
    }

    // Mock verification process
    // In production, integrate with UIDAI API or third-party verification service
    const isValid = /^\d{12}$/.test(aadhaarNumber);
    
    if (isValid) {
      // Encrypt and store Aadhaar number
      const encryptedAadhaar = encryptData(aadhaarNumber);
      
      await User.findByIdAndUpdate(req.user.userId, {
        aadhaarNumber: encryptedAadhaar,
        aadhaarVerified: true
      });

      res.json({
        success: true,
        message: 'Aadhaar verified successfully',
        data: {
          aadhaarVerified: true,
          verificationDate: new Date()
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid Aadhaar number format'
      });
    }

  } catch (error) {
    console.error('Aadhaar verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify Aadhaar',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Verify PAN (mock implementation)
router.post('/verify-pan', authenticateToken, async (req, res) => {
  try {
    const { error, value } = verificationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { panNumber, documentImage } = value;
    
    if (!panNumber) {
      return res.status(400).json({
        success: false,
        message: 'PAN number is required'
      });
    }

    // Mock verification process
    // In production, integrate with Income Tax Department API or third-party service
    const isValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber);
    
    if (isValid) {
      // Encrypt and store PAN number
      const encryptedPAN = encryptData(panNumber);
      
      await User.findByIdAndUpdate(req.user.userId, {
        panNumber: encryptedPAN,
        panVerified: true
      });

      res.json({
        success: true,
        message: 'PAN verified successfully',
        data: {
          panVerified: true,
          verificationDate: new Date()
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid PAN number format'
      });
    }

  } catch (error) {
    console.error('PAN verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify PAN',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get user dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's loans summary
    const Loan = require('../models/Loan');
    const loans = await Loan.find({ userId: req.user.userId });
    
    const activeLoan = loans.find(loan => loan.status === 'disbursed');
    const pendingApplications = loans.filter(loan => 
      ['pending', 'under_review'].includes(loan.status)
    ).length;

    // Calculate next EMI if there's an active loan
    let nextEMI = null;
    if (activeLoan) {
      nextEMI = activeLoan.getNextEMI();
    }

    // Get credit analysis summary
    const CreditAnalysis = require('../models/CreditAnalysis');
    const latestAnalysis = await CreditAnalysis.findOne({ userId: req.user.userId })
      .sort({ analysisDate: -1 });

    const dashboard = {
      user: {
        name: user.name,
        phoneNumber: user.phoneNumber,
        preferredLanguage: user.preferredLanguage,
        profileComplete: user.aadhaarVerified && user.panVerified,
        creditScore: user.creditScore,
        riskCategory: user.riskCategory
      },
      verification: {
        aadhaarVerified: user.aadhaarVerified,
        panVerified: user.panVerified,
        completionPercentage: (
          (user.aadhaarVerified ? 50 : 0) + 
          (user.panVerified ? 50 : 0)
        )
      },
      loans: {
        totalApplied: user.totalLoansApplied,
        totalApproved: user.totalLoansApproved,
        currentLoanAmount: user.currentLoanAmount,
        pendingApplications: pendingApplications,
        activeLoan: activeLoan ? {
          loanId: activeLoan.loanId,
          amount: activeLoan.amount,
          emiAmount: activeLoan.emiAmount,
          nextEMI: nextEMI
        } : null
      },
      creditAnalysis: latestAnalysis ? {
        score: latestAnalysis.alternativeCreditScore,
        riskCategory: latestAnalysis.riskCategory,
        confidenceLevel: latestAnalysis.confidenceLevel,
        lastUpdated: latestAnalysis.analysisDate,
        eligible: latestAnalysis.loanRecommendation.eligible,
        maxLoanAmount: latestAnalysis.loanRecommendation.maxLoanAmount
      } : null,
      quickActions: [
        {
          id: 'apply_loan',
          title: user.preferredLanguage === 'hindi' ? 'लोन के लिए आवेदन करें' : 'Apply for Loan',
          enabled: user.isEligibleForLoan(),
          icon: 'loan'
        },
        {
          id: 'check_eligibility',
          title: user.preferredLanguage === 'hindi' ? 'पात्रता जांचें' : 'Check Eligibility',
          enabled: true,
          icon: 'check'
        },
        {
          id: 'voice_assistant',
          title: user.preferredLanguage === 'hindi' ? 'आवाज सहायक' : 'Voice Assistant',
          enabled: user.voiceEnabled,
          icon: 'microphone'
        }
      ]
    };

    res.json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get user notifications
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, page = 1, unreadOnly = false } = req.query;
    
    // Mock notifications - in production, implement proper notification system
    const notifications = [
      {
        id: '1',
        type: 'loan_approved',
        title: 'Loan Approved',
        message: 'Your loan application has been approved. Amount will be disbursed soon.',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        read: false,
        priority: 'high'
      },
      {
        id: '2',
        type: 'emi_reminder',
        title: 'EMI Due Reminder',
        message: 'Your EMI of Rs. 2,500 is due on 15th of this month.',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        read: true,
        priority: 'medium'
      },
      {
        id: '3',
        type: 'credit_score_update',
        title: 'Credit Score Updated',
        message: 'Your credit score has been updated to 720.',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        read: true,
        priority: 'low'
      }
    ];

    const filteredNotifications = unreadOnly === 'true' 
      ? notifications.filter(n => !n.read)
      : notifications;

    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedNotifications = filteredNotifications.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        notifications: paginatedNotifications,
        unreadCount: notifications.filter(n => !n.read).length,
        pagination: {
          total: filteredNotifications.length,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(filteredNotifications.length / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Mark notification as read
router.put('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // Mock implementation - in production, update notification in database
    res.json({
      success: true,
      message: 'Notification marked as read',
      data: {
        notificationId: notificationId,
        readAt: new Date()
      }
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete user account (soft delete)
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const { confirmPassword } = req.body;
    
    if (!confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password confirmation required'
      });
    }

    const user = await User.findById(req.user.userId);
    const isPasswordValid = await user.comparePassword(confirmPassword);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Check if user has active loans
    const Loan = require('../models/Loan');
    const activeLoans = await Loan.find({ 
      userId: req.user.userId, 
      status: { $in: ['approved', 'disbursed'] }
    });

    if (activeLoans.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with active loans',
        activeLoans: activeLoans.length
      });
    }

    // Soft delete - deactivate account
    await User.findByIdAndUpdate(req.user.userId, {
      isActive: false,
      deactivatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
