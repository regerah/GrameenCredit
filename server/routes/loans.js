const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { authenticateToken, requireVerifiedIdentity, requireLoanEligibility } = require('../middleware/auth');
const Loan = require('../models/Loan');
const User = require('../models/User');
const CreditAnalysis = require('../models/CreditAnalysis');
const { sendLoanStatusSMS } = require('../services/smsService');
const { generateLoanRecommendation } = require('../services/llmService');

const router = express.Router();

// Configure multer for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed'));
    }
  }
});

// Validation schemas
const loanApplicationSchema = Joi.object({
  amount: Joi.number().min(5000).max(100000).required(),
  purpose: Joi.string().valid('agriculture', 'business', 'education', 'medical', 'personal', 'emergency').required(),
  tenure: Joi.number().min(3).max(24).required(),
  monthlyIncome: Joi.number().min(0).optional()
});

// Apply for loan
router.post('/apply', authenticateToken, requireVerifiedIdentity, requireLoanEligibility, async (req, res) => {
  try {
    const { error, value } = loanApplicationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { amount, purpose, tenure, monthlyIncome } = value;
    const user = await User.findById(req.user.userId);

    // Get latest credit analysis
    const creditAnalysis = await CreditAnalysis.findOne({ userId: req.user.userId })
      .sort({ analysisDate: -1 });

    if (!creditAnalysis) {
      return res.status(400).json({
        success: false,
        message: 'Credit analysis required before loan application',
        requiresCreditAnalysis: true
      });
    }

    // Check if requested amount is within recommended limits
    const maxAllowed = creditAnalysis.loanRecommendation.maxLoanAmount;
    if (amount > maxAllowed) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds maximum allowed limit of Rs. ${maxAllowed}`,
        maxAllowedAmount: maxAllowed,
        recommendedAmount: creditAnalysis.loanRecommendation.recommendedAmount
      });
    }

    // Calculate interest rate based on credit score and risk
    let interestRate = creditAnalysis.loanRecommendation.suggestedInterestRate || 18.0;
    
    // Adjust based on amount and tenure
    if (amount > 50000) interestRate += 1.0;
    if (tenure > 18) interestRate += 0.5;

    // Create loan application
    const loan = new Loan({
      userId: req.user.userId,
      amount: amount,
      interestRate: interestRate,
      tenure: tenure,
      purpose: purpose,
      creditScore: creditAnalysis.alternativeCreditScore,
      riskScore: (100 - creditAnalysis.alternativeCreditScore) / 10, // Convert to 0-10 scale
      alternativeCreditData: {
        smsAnalysis: creditAnalysis.smsAnalysis,
        upiAnalysis: creditAnalysis.upiAnalysis,
        mobileUsage: creditAnalysis.mobileUsage
      },
      aiDecisionConfidence: creditAnalysis.confidenceLevel
    });

    // Calculate EMI
    loan.calculateEMI();

    // Auto-approve based on credit score and confidence
    if (creditAnalysis.alternativeCreditScore >= 650 && creditAnalysis.confidenceLevel >= 0.7) {
      loan.status = 'approved';
      loan.approvalDate = new Date();
      loan.approvalReason = 'Auto-approved based on strong credit profile';
      
      // Update user loan count
      user.totalLoansApproved += 1;
      user.currentLoanAmount = amount;
      await user.save();
    } else if (creditAnalysis.alternativeCreditScore < 500) {
      loan.status = 'rejected';
      loan.rejectionReason = 'Credit score below minimum threshold';
    } else {
      loan.status = 'under_review';
    }

    // Add status to history
    loan.addStatusHistory(loan.status, loan.approvalReason || loan.rejectionReason || 'Application submitted');

    await loan.save();

    // Update user application count
    user.totalLoansApplied += 1;
    await user.save();

    // Send SMS notification
    try {
      await sendLoanStatusSMS(
        user.phoneNumber, 
        loan.loanId, 
        loan.status, 
        user.preferredLanguage
      );
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
    }

    res.status(201).json({
      success: true,
      message: 'Loan application submitted successfully',
      data: {
        loanId: loan.loanId,
        status: loan.status,
        amount: loan.amount,
        interestRate: loan.interestRate,
        tenure: loan.tenure,
        emiAmount: loan.emiAmount,
        totalAmount: loan.totalAmount,
        applicationDate: loan.applicationDate,
        approvalDate: loan.approvalDate,
        expectedDisbursalDate: loan.status === 'approved' 
          ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 days from now
          : null
      }
    });

  } catch (error) {
    console.error('Loan application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit loan application',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get loan status
router.get('/status/:loanId', authenticateToken, async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findOne({ 
      loanId: loanId,
      userId: req.user.userId 
    }).populate('userId', 'name phoneNumber preferredLanguage');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Calculate progress
    const totalEMIs = loan.repaymentSchedule.length;
    const paidEMIs = loan.repaymentSchedule.filter(emi => emi.status === 'paid').length;
    const progress = totalEMIs > 0 ? (paidEMIs / totalEMIs) * 100 : 0;

    // Get next EMI
    const nextEMI = loan.getNextEMI();
    const overdueEMIs = loan.getOverdueEMIs();

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        amount: loan.amount,
        interestRate: loan.interestRate,
        tenure: loan.tenure,
        emiAmount: loan.emiAmount,
        totalAmount: loan.totalAmount,
        applicationDate: loan.applicationDate,
        approvalDate: loan.approvalDate,
        disbursalDate: loan.disbursalDate,
        progress: Math.round(progress),
        nextEMI: nextEMI,
        overdueEMIs: overdueEMIs,
        canBeClosed: loan.canBeClosed(),
        statusHistory: loan.statusHistory
      }
    });

  } catch (error) {
    console.error('Loan status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all user loans
router.get('/my-loans', authenticateToken, async (req, res) => {
  try {
    const { status, limit = 10, page = 1 } = req.query;

    const query = { userId: req.user.userId };
    if (status) {
      query.status = status;
    }

    const loans = await Loan.find(query)
      .sort({ applicationDate: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('loanId status amount interestRate tenure emiAmount applicationDate approvalDate disbursalDate');

    const total = await Loan.countDocuments(query);

    res.json({
      success: true,
      data: {
        loans: loans,
        pagination: {
          total: total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('My loans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loans',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Upload loan documents
router.post('/:loanId/documents', authenticateToken, upload.array('documents', 5), async (req, res) => {
  try {
    const { loanId } = req.params;
    const { documentTypes } = req.body; // Array of document types corresponding to files

    const loan = await Loan.findOne({ 
      loanId: loanId,
      userId: req.user.userId 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No documents uploaded'
      });
    }

    const allowedTypes = ['aadhaar', 'pan', 'income_proof', 'bank_statement', 'photo'];
    const uploadedDocs = [];

    // Process each uploaded file
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const docType = documentTypes ? documentTypes[i] : 'other';

      if (!allowedTypes.includes(docType)) {
        continue;
      }

      // In production, save to cloud storage (AWS S3, Google Cloud Storage, etc.)
      const filename = `${loanId}_${docType}_${Date.now()}.${file.originalname.split('.').pop()}`;
      
      // For now, just store metadata
      const document = {
        type: docType,
        filename: filename,
        uploadDate: new Date(),
        verified: false
      };

      loan.documents.push(document);
      uploadedDocs.push(document);
    }

    await loan.save();

    res.json({
      success: true,
      message: 'Documents uploaded successfully',
      data: {
        loanId: loan.loanId,
        uploadedDocuments: uploadedDocs,
        totalDocuments: loan.documents.length
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload documents',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get EMI schedule
router.get('/:loanId/emi-schedule', authenticateToken, async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findOne({ 
      loanId: loanId,
      userId: req.user.userId 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Generate schedule if not exists
    if (loan.repaymentSchedule.length === 0 && loan.status === 'disbursed') {
      loan.generateRepaymentSchedule();
      await loan.save();
    }

    const schedule = loan.repaymentSchedule.map(emi => ({
      emiNumber: emi.emiNumber,
      dueDate: emi.dueDate,
      amount: emi.amount,
      status: emi.status,
      paidDate: emi.paidDate,
      paidAmount: emi.paidAmount,
      isOverdue: emi.status === 'pending' && emi.dueDate < new Date()
    }));

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        totalEMIs: schedule.length,
        paidEMIs: schedule.filter(emi => emi.status === 'paid').length,
        pendingEMIs: schedule.filter(emi => emi.status === 'pending').length,
        overdueEMIs: schedule.filter(emi => emi.isOverdue).length,
        schedule: schedule
      }
    });

  } catch (error) {
    console.error('EMI schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch EMI schedule',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Simulate EMI payment (in production, integrate with payment gateway)
router.post('/:loanId/pay-emi', authenticateToken, async (req, res) => {
  try {
    const { loanId } = req.params;
    const { emiNumber, amount, paymentMethod = 'upi' } = req.body;

    const loan = await Loan.findOne({ 
      loanId: loanId,
      userId: req.user.userId 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Find the EMI to pay
    const emiIndex = loan.repaymentSchedule.findIndex(emi => emi.emiNumber === emiNumber);
    if (emiIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'EMI not found'
      });
    }

    const emi = loan.repaymentSchedule[emiIndex];
    if (emi.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'EMI already paid'
      });
    }

    // Validate payment amount
    if (amount < emi.amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient payment amount',
        requiredAmount: emi.amount,
        providedAmount: amount
      });
    }

    // Process payment
    loan.repaymentSchedule[emiIndex].status = 'paid';
    loan.repaymentSchedule[emiIndex].paidDate = new Date();
    loan.repaymentSchedule[emiIndex].paidAmount = amount;

    // Check if loan is fully paid
    if (loan.canBeClosed()) {
      loan.status = 'closed';
      loan.addStatusHistory('closed', 'All EMIs paid successfully');
      
      // Update user's current loan amount
      const user = await User.findById(req.user.userId);
      user.currentLoanAmount = 0;
      await user.save();
    }

    await loan.save();

    res.json({
      success: true,
      message: 'EMI payment successful',
      data: {
        loanId: loan.loanId,
        emiNumber: emiNumber,
        paidAmount: amount,
        paidDate: new Date(),
        remainingEMIs: loan.repaymentSchedule.filter(e => e.status === 'pending').length,
        loanStatus: loan.status,
        nextEMI: loan.getNextEMI()
      }
    });

  } catch (error) {
    console.error('EMI payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process EMI payment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get loan eligibility
router.get('/eligibility', authenticateToken, requireVerifiedIdentity, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const creditAnalysis = await CreditAnalysis.findOne({ userId: req.user.userId })
      .sort({ analysisDate: -1 });

    const eligibility = {
      isEligible: user.isEligibleForLoan(),
      reasons: [],
      recommendations: []
    };

    // Check eligibility criteria
    if (!user.aadhaarVerified) {
      eligibility.reasons.push('Aadhaar verification required');
      eligibility.recommendations.push('Complete Aadhaar verification');
    }

    if (!user.panVerified) {
      eligibility.reasons.push('PAN verification required');
      eligibility.recommendations.push('Complete PAN verification');
    }

    if (user.currentLoanAmount > 0) {
      eligibility.reasons.push('Existing loan must be cleared');
      eligibility.recommendations.push('Pay off current loan before applying for new loan');
    }

    if (!creditAnalysis) {
      eligibility.reasons.push('Credit analysis required');
      eligibility.recommendations.push('Complete credit analysis by providing SMS/UPI data');
    } else {
      eligibility.creditScore = creditAnalysis.alternativeCreditScore;
      eligibility.riskCategory = creditAnalysis.riskCategory;
      eligibility.maxLoanAmount = creditAnalysis.loanRecommendation.maxLoanAmount;
      eligibility.recommendedAmount = creditAnalysis.loanRecommendation.recommendedAmount;
      eligibility.suggestedInterestRate = creditAnalysis.loanRecommendation.suggestedInterestRate;
    }

    res.json({
      success: true,
      data: eligibility
    });

  } catch (error) {
    console.error('Loan eligibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check loan eligibility',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
