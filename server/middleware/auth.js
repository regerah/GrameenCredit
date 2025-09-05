const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Authenticate JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and is active
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found'
      });
    }

    // Add user info to request
    req.user = {
      userId: decoded.userId,
      phoneNumber: decoded.phoneNumber,
      preferredLanguage: decoded.preferredLanguage,
      userData: user
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Check if user has verified identity
const requireVerifiedIdentity = (req, res, next) => {
  if (!req.user.userData.aadhaarVerified || !req.user.userData.panVerified) {
    return res.status(403).json({
      success: false,
      message: 'Identity verification required',
      requiresVerification: {
        aadhaar: !req.user.userData.aadhaarVerified,
        pan: !req.user.userData.panVerified
      }
    });
  }
  next();
};

// Check if user is eligible for loan
const requireLoanEligibility = (req, res, next) => {
  if (!req.user.userData.isEligibleForLoan()) {
    return res.status(403).json({
      success: false,
      message: 'User not eligible for loan',
      reasons: [
        !req.user.userData.aadhaarVerified && 'Aadhaar verification required',
        !req.user.userData.panVerified && 'PAN verification required',
        req.user.userData.currentLoanAmount > 0 && 'Existing loan must be cleared',
        !req.user.userData.isActive && 'Account is inactive'
      ].filter(Boolean)
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireVerifiedIdentity,
  requireLoanEligibility
};
