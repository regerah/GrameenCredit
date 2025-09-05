const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { authenticateToken, requireVerifiedIdentity } = require('../middleware/auth');
const { calculateAlternativeCreditScore } = require('../services/creditScoringService');
const CreditAnalysis = require('../models/CreditAnalysis');
const User = require('../models/User');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Validation schemas
const smsAnalysisSchema = Joi.object({
  smsData: Joi.array().items(
    Joi.object({
      date: Joi.date().required(),
      message: Joi.string().required(),
      sender: Joi.string().required()
    })
  ).required(),
  consentGiven: Joi.boolean().valid(true).required()
});

const consentSchema = Joi.object({
  smsAnalysisConsent: Joi.boolean().required(),
  upiAnalysisConsent: Joi.boolean().required()
});

// Give consent for data analysis
router.post('/consent', authenticateToken, async (req, res) => {
  try {
    const { error, value } = consentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { smsAnalysisConsent, upiAnalysisConsent } = value;

    // Update user consent
    await User.findByIdAndUpdate(req.user.userId, {
      smsAnalysisConsent,
      upiAnalysisConsent,
      consentTimestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Consent preferences updated successfully',
      data: {
        smsAnalysisConsent,
        upiAnalysisConsent,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('Consent update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update consent preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Analyze SMS data for credit scoring
router.post('/analyze-sms', authenticateToken, requireVerifiedIdentity, async (req, res) => {
  try {
    const { error, value } = smsAnalysisSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Check if user has given consent
    const user = await User.findById(req.user.userId);
    if (!user.smsAnalysisConsent) {
      return res.status(403).json({
        success: false,
        message: 'SMS analysis consent required',
        requiresConsent: true
      });
    }

    const { smsData } = value;

    // Process SMS data for credit analysis
    const userData = {
      smsData: smsData,
      userId: req.user.userId,
      monthlyIncome: user.monthlyIncome,
      occupation: user.occupation
    };

    // Calculate credit score
    const creditAnalysis = await calculateAlternativeCreditScore(req.user.userId, userData);

    // Update user's credit score
    await User.findByIdAndUpdate(req.user.userId, {
      creditScore: creditAnalysis.alternativeCreditScore,
      creditScoreLastUpdated: new Date(),
      riskCategory: creditAnalysis.riskCategory
    });

    res.json({
      success: true,
      message: 'SMS data analyzed successfully',
      data: {
        creditScore: creditAnalysis.alternativeCreditScore,
        riskCategory: creditAnalysis.riskCategory,
        confidenceLevel: creditAnalysis.confidenceLevel,
        analysisId: creditAnalysis._id,
        recommendation: creditAnalysis.loanRecommendation,
        summary: creditAnalysis.getSummary()
      }
    });

  } catch (error) {
    console.error('SMS analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze SMS data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Upload and analyze UPI transaction data
router.post('/analyze-upi', authenticateToken, requireVerifiedIdentity, upload.single('upiData'), async (req, res) => {
  try {
    // Check consent
    const user = await User.findById(req.user.userId);
    if (!user.upiAnalysisConsent) {
      return res.status(403).json({
        success: false,
        message: 'UPI analysis consent required',
        requiresConsent: true
      });
    }

    let upiData = [];
    
    // Parse UPI data from file or request body
    if (req.file) {
      const fileContent = req.file.buffer.toString('utf8');
      upiData = JSON.parse(fileContent);
    } else if (req.body.upiData) {
      upiData = req.body.upiData;
    } else {
      return res.status(400).json({
        success: false,
        message: 'UPI data is required'
      });
    }

    // Process UPI data
    const userData = {
      upiData: upiData,
      userId: req.user.userId,
      monthlyIncome: user.monthlyIncome,
      occupation: user.occupation
    };

    // Calculate credit score
    const creditAnalysis = await calculateAlternativeCreditScore(req.user.userId, userData);

    // Update user's credit score
    await User.findByIdAndUpdate(req.user.userId, {
      creditScore: creditAnalysis.alternativeCreditScore,
      creditScoreLastUpdated: new Date(),
      riskCategory: creditAnalysis.riskCategory
    });

    res.json({
      success: true,
      message: 'UPI data analyzed successfully',
      data: {
        creditScore: creditAnalysis.alternativeCreditScore,
        riskCategory: creditAnalysis.riskCategory,
        confidenceLevel: creditAnalysis.confidenceLevel,
        analysisId: creditAnalysis._id,
        recommendation: creditAnalysis.loanRecommendation
      }
    });

  } catch (error) {
    console.error('UPI analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze UPI data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get comprehensive credit score
router.post('/score', authenticateToken, requireVerifiedIdentity, async (req, res) => {
  try {
    const { smsData, upiData, mobileData } = req.body;

    // Check user consent
    const user = await User.findById(req.user.userId);
    
    const userData = {
      userId: req.user.userId,
      monthlyIncome: user.monthlyIncome,
      occupation: user.occupation
    };

    // Add data based on consent
    if (user.smsAnalysisConsent && smsData) {
      userData.smsData = smsData;
    }
    if (user.upiAnalysisConsent && upiData) {
      userData.upiData = upiData;
    }
    if (mobileData) {
      userData.mobileData = mobileData;
    }

    // Calculate comprehensive credit score
    const creditAnalysis = await calculateAlternativeCreditScore(req.user.userId, userData);

    // Update user profile
    await User.findByIdAndUpdate(req.user.userId, {
      creditScore: creditAnalysis.alternativeCreditScore,
      creditScoreLastUpdated: new Date(),
      riskCategory: creditAnalysis.riskCategory
    });

    res.json({
      success: true,
      message: 'Credit score calculated successfully',
      data: {
        creditScore: creditAnalysis.alternativeCreditScore,
        riskCategory: creditAnalysis.riskCategory,
        confidenceLevel: creditAnalysis.confidenceLevel,
        components: creditAnalysis.creditScoreComponents,
        recommendation: creditAnalysis.loanRecommendation,
        redFlags: creditAnalysis.redFlags,
        positiveIndicators: creditAnalysis.positiveIndicators,
        analysisDate: creditAnalysis.analysisDate,
        dataSourcesUsed: creditAnalysis.dataSourcesUsed
      }
    });

  } catch (error) {
    console.error('Credit scoring error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate credit score',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get credit report
router.get('/report/:userId?', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId || req.user.userId;
    
    // Only allow users to access their own reports (admin access can be added later)
    if (userId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const creditAnalysis = await CreditAnalysis.findOne({ userId }).sort({ analysisDate: -1 });
    
    if (!creditAnalysis) {
      return res.status(404).json({
        success: false,
        message: 'No credit analysis found',
        suggestion: 'Please complete credit analysis first'
      });
    }

    const user = await User.findById(userId).select('-password');

    res.json({
      success: true,
      data: {
        user: {
          name: user.name,
          phoneNumber: user.phoneNumber,
          occupation: user.occupation,
          monthlyIncome: user.monthlyIncome,
          creditScore: user.creditScore,
          riskCategory: user.riskCategory
        },
        analysis: {
          creditScore: creditAnalysis.alternativeCreditScore,
          riskCategory: creditAnalysis.riskCategory,
          confidenceLevel: creditAnalysis.confidenceLevel,
          components: creditAnalysis.creditScoreComponents,
          recommendation: creditAnalysis.loanRecommendation,
          redFlags: creditAnalysis.redFlags,
          positiveIndicators: creditAnalysis.positiveIndicators,
          analysisDate: creditAnalysis.analysisDate,
          dataSourcesUsed: creditAnalysis.dataSourcesUsed
        }
      }
    });

  } catch (error) {
    console.error('Credit report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit report',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get credit score history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.query;
    
    const analyses = await CreditAnalysis.find({ userId: req.user.userId })
      .sort({ analysisDate: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('alternativeCreditScore riskCategory confidenceLevel analysisDate dataSourcesUsed');

    const total = await CreditAnalysis.countDocuments({ userId: req.user.userId });

    res.json({
      success: true,
      data: {
        analyses: analyses,
        pagination: {
          total: total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Credit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit history',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Refresh credit score
router.post('/refresh', authenticateToken, requireVerifiedIdentity, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    // Check if enough time has passed since last update (e.g., 24 hours)
    if (user.creditScoreLastUpdated) {
      const hoursSinceUpdate = (new Date() - user.creditScoreLastUpdated) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        return res.status(429).json({
          success: false,
          message: 'Credit score can only be refreshed once every 24 hours',
          nextRefreshTime: new Date(user.creditScoreLastUpdated.getTime() + 24 * 60 * 60 * 1000)
        });
      }
    }

    // Get latest analysis
    const latestAnalysis = await CreditAnalysis.findOne({ userId: req.user.userId })
      .sort({ analysisDate: -1 });

    if (!latestAnalysis) {
      return res.status(404).json({
        success: false,
        message: 'No previous analysis found. Please complete initial credit analysis.'
      });
    }

    // Recalculate with existing data
    const userData = {
      userId: req.user.userId,
      monthlyIncome: user.monthlyIncome,
      occupation: user.occupation,
      smsData: [], // In production, fetch latest SMS data
      upiData: [], // In production, fetch latest UPI data
      mobileData: [] // In production, fetch latest mobile data
    };

    const updatedAnalysis = await calculateAlternativeCreditScore(req.user.userId, userData);

    await User.findByIdAndUpdate(req.user.userId, {
      creditScore: updatedAnalysis.alternativeCreditScore,
      creditScoreLastUpdated: new Date(),
      riskCategory: updatedAnalysis.riskCategory
    });

    res.json({
      success: true,
      message: 'Credit score refreshed successfully',
      data: {
        previousScore: latestAnalysis.alternativeCreditScore,
        newScore: updatedAnalysis.alternativeCreditScore,
        change: updatedAnalysis.alternativeCreditScore - latestAnalysis.alternativeCreditScore,
        riskCategory: updatedAnalysis.riskCategory,
        recommendation: updatedAnalysis.loanRecommendation
      }
    });

  } catch (error) {
    console.error('Credit refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh credit score',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
