const rateLimit = require('express-rate-limit');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Rate limiting configurations
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs: windowMs,
    max: max,
    message: {
      success: false,
      message: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Different rate limits for different endpoints
const authRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts, please try again later'
);

const otpRateLimit = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  3, // 3 OTP requests
  'Too many OTP requests, please wait before requesting again'
);

const loanApplicationRateLimit = createRateLimiter(
  24 * 60 * 60 * 1000, // 24 hours
  3, // 3 loan applications per day
  'Too many loan applications, please try again tomorrow'
);

const generalAPIRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests, please slow down'
);

// Advanced rate limiting with Redis (for production)
class AdvancedRateLimiter {
  constructor() {
    // In production, use Redis for distributed rate limiting
    this.rateLimiter = new RateLimiterRedis({
      storeClient: null, // Redis client would go here
      keyPrefix: 'grameencredit_rl',
      points: 100, // Number of requests
      duration: 900, // Per 15 minutes
    });
  }

  async checkLimit(key, points = 1) {
    try {
      await this.rateLimiter.consume(key, points);
      return { allowed: true };
    } catch (rejRes) {
      return {
        allowed: false,
        msBeforeNext: rejRes.msBeforeNext,
        remainingPoints: rejRes.remainingPoints,
        totalHits: rejRes.totalHits
      };
    }
  }
}

// Device fingerprinting for additional security
const generateDeviceFingerprint = (req) => {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const ip = req.ip || req.connection.remoteAddress;
  
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${userAgent}${acceptLanguage}${acceptEncoding}${ip}`)
    .digest('hex');
    
  return fingerprint;
};

// Device binding middleware
const deviceBinding = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }

    const currentFingerprint = generateDeviceFingerprint(req);
    const storedDeviceId = req.user.userData.deviceId;

    // For new users or if no device ID is stored
    if (!storedDeviceId) {
      // Store the current device fingerprint
      await req.user.userData.updateOne({ deviceId: currentFingerprint });
      return next();
    }

    // Check if device matches
    if (storedDeviceId !== currentFingerprint) {
      // Device mismatch - require additional verification
      return res.status(403).json({
        success: false,
        message: 'Device not recognized. Additional verification required.',
        requiresDeviceVerification: true,
        deviceFingerprint: currentFingerprint
      });
    }

    next();
  } catch (error) {
    console.error('Device binding error:', error);
    next(); // Continue on error to avoid blocking legitimate users
  }
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Remove potentially dangerous characters
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+\s*=/gi, '')
                .trim();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitize(obj[key]);
        }
      }
      return sanitized;
    }
    
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  
  if (req.query) {
    req.query = sanitize(req.query);
  }
  
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
};

// Request validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }
    next();
  };
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Strict transport security (HTTPS only)
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api.openai.com https://speech.googleapis.com"
  );
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
};

// API key validation for external integrations
const validateAPIKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required'
    });
  }
  
  // In production, validate against stored API keys
  const validAPIKeys = process.env.VALID_API_KEYS?.split(',') || [];
  
  if (!validAPIKeys.includes(apiKey)) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key'
    });
  }
  
  next();
};

// Fraud detection middleware
const fraudDetection = async (req, res, next) => {
  try {
    const suspiciousPatterns = [];
    
    // Check for suspicious IP patterns
    const ip = req.ip || req.connection.remoteAddress;
    if (ip && (ip.includes('tor') || ip.includes('proxy'))) {
      suspiciousPatterns.push('suspicious_ip');
    }
    
    // Check for unusual request timing
    const userAgent = req.headers['user-agent'];
    if (!userAgent || userAgent.length < 10) {
      suspiciousPatterns.push('missing_user_agent');
    }
    
    // Check for rapid successive requests
    if (req.user?.userId) {
      const key = `fraud_check_${req.user.userId}`;
      const recentRequests = req.app.locals.recentRequests || new Map();
      
      const now = Date.now();
      const userRequests = recentRequests.get(key) || [];
      
      // Remove requests older than 1 minute
      const recentUserRequests = userRequests.filter(time => now - time < 60000);
      
      if (recentUserRequests.length > 20) { // More than 20 requests per minute
        suspiciousPatterns.push('rapid_requests');
      }
      
      recentUserRequests.push(now);
      recentRequests.set(key, recentUserRequests);
      req.app.locals.recentRequests = recentRequests;
    }
    
    // If suspicious patterns detected, add to user's fraud flags
    if (suspiciousPatterns.length > 0 && req.user?.userId) {
      const User = require('../models/User');
      await User.findByIdAndUpdate(req.user.userId, {
        $push: {
          fraudFlags: {
            $each: suspiciousPatterns.map(pattern => ({
              type: pattern,
              timestamp: new Date()
            }))
          }
        }
      });
      
      console.warn(`Fraud patterns detected for user ${req.user.userId}:`, suspiciousPatterns);
    }
    
    next();
  } catch (error) {
    console.error('Fraud detection error:', error);
    next(); // Continue on error
  }
};

// Session management
const sessionSecurity = (req, res, next) => {
  // Add session security headers
  if (req.session) {
    req.session.cookie.secure = process.env.NODE_ENV === 'production';
    req.session.cookie.httpOnly = true;
    req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
    req.session.cookie.sameSite = 'strict';
  }
  
  next();
};

// Data masking for sensitive information
const maskSensitiveData = (data) => {
  const masked = { ...data };
  
  // Mask phone numbers
  if (masked.phoneNumber) {
    masked.phoneNumber = masked.phoneNumber.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2');
  }
  
  // Mask Aadhaar numbers
  if (masked.aadhaarNumber) {
    masked.aadhaarNumber = masked.aadhaarNumber.replace(/(\d{4})\d{4}(\d{4})/, '$1****$2');
  }
  
  // Mask PAN numbers
  if (masked.panNumber) {
    masked.panNumber = masked.panNumber.replace(/([A-Z]{3})\w{2}(\d{4}[A-Z])/, '$1**$2');
  }
  
  return masked;
};

// Response masking middleware
const maskSensitiveResponse = (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    if (data && data.data && typeof data.data === 'object') {
      data.data = maskSensitiveData(data.data);
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = {
  authRateLimit,
  otpRateLimit,
  loanApplicationRateLimit,
  generalAPIRateLimit,
  AdvancedRateLimiter,
  deviceBinding,
  sanitizeInput,
  validateRequest,
  securityHeaders,
  validateAPIKey,
  fraudDetection,
  sessionSecurity,
  maskSensitiveData,
  maskSensitiveResponse,
  generateDeviceFingerprint
};
