const mongoose = require('mongoose');

const creditAnalysisSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // SMS Transaction Analysis
  smsAnalysis: {
    totalTransactions: {
      type: Number,
      default: 0
    },
    creditTransactions: {
      type: Number,
      default: 0
    },
    debitTransactions: {
      type: Number,
      default: 0
    },
    averageBalance: {
      type: Number,
      default: 0
    },
    balanceStability: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    regularityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    merchantDiversity: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    salaryCredits: [{
      amount: Number,
      date: Date,
      source: String
    }],
    recurringPayments: [{
      merchant: String,
      amount: Number,
      frequency: String,
      lastPayment: Date
    }]
  },
  
  // UPI Transaction Analysis
  upiAnalysis: {
    monthlyTransactionCount: {
      type: Number,
      default: 0
    },
    averageTransactionAmount: {
      type: Number,
      default: 0
    },
    totalVolume: {
      type: Number,
      default: 0
    },
    paymentRegularity: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    digitalFootprintScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    merchantCategories: [{
      category: String,
      transactionCount: Number,
      totalAmount: Number
    }],
    peakTransactionHours: [Number],
    weekdayVsWeekendRatio: Number
  },
  
  // Mobile Usage Analysis
  mobileUsage: {
    rechargeFrequency: {
      type: Number,
      default: 0
    },
    averageRechargeAmount: {
      type: Number,
      default: 0
    },
    planType: {
      type: String,
      enum: ['prepaid', 'postpaid', 'unknown'],
      default: 'unknown'
    },
    dataUsagePattern: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    consistencyScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  },
  
  // Alternative Credit Score Components
  creditScoreComponents: {
    transactionBehavior: {
      score: Number,
      weight: Number,
      factors: [String]
    },
    paymentRegularity: {
      score: Number,
      weight: Number,
      factors: [String]
    },
    digitalEngagement: {
      score: Number,
      weight: Number,
      factors: [String]
    },
    financialStability: {
      score: Number,
      weight: Number,
      factors: [String]
    },
    socialSignals: {
      score: Number,
      weight: Number,
      factors: [String]
    }
  },
  
  // Final Scores
  alternativeCreditScore: {
    type: Number,
    min: 300,
    max: 900,
    required: true
  },
  confidenceLevel: {
    type: Number,
    min: 0,
    max: 1,
    required: true
  },
  riskCategory: {
    type: String,
    enum: ['low', 'medium', 'high'],
    required: true
  },
  
  // Analysis Metadata
  analysisDate: {
    type: Date,
    default: Date.now
  },
  dataSourcesUsed: [{
    source: String,
    dataPoints: Number,
    dateRange: {
      start: Date,
      end: Date
    }
  }],
  modelVersion: {
    type: String,
    default: '1.0'
  },
  
  // Red Flags and Positive Indicators
  redFlags: [{
    type: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    description: String,
    impact: Number
  }],
  positiveIndicators: [{
    type: String,
    strength: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    description: String,
    impact: Number
  }],
  
  // Recommendations
  loanRecommendation: {
    eligible: {
      type: Boolean,
      required: true
    },
    maxLoanAmount: {
      type: Number,
      min: 0
    },
    recommendedAmount: {
      type: Number,
      min: 0
    },
    suggestedInterestRate: {
      type: Number,
      min: 8.0,
      max: 24.0
    },
    maxTenure: {
      type: Number,
      min: 3,
      max: 24
    },
    conditions: [String]
  }
}, {
  timestamps: true
});

// Indexes
creditAnalysisSchema.index({ userId: 1 });
creditAnalysisSchema.index({ analysisDate: -1 });
creditAnalysisSchema.index({ alternativeCreditScore: 1 });
creditAnalysisSchema.index({ riskCategory: 1 });

// Calculate overall credit score
creditAnalysisSchema.methods.calculateCreditScore = function() {
  const components = this.creditScoreComponents;
  let weightedScore = 0;
  let totalWeight = 0;
  
  Object.keys(components).forEach(key => {
    const component = components[key];
    if (component.score && component.weight) {
      weightedScore += component.score * component.weight;
      totalWeight += component.weight;
    }
  });
  
  if (totalWeight === 0) return 300; // Minimum score
  
  const normalizedScore = (weightedScore / totalWeight);
  // Scale to 300-900 range
  this.alternativeCreditScore = Math.round(300 + (normalizedScore * 6));
  
  return this.alternativeCreditScore;
};

// Determine risk category based on score
creditAnalysisSchema.methods.determineRiskCategory = function() {
  const score = this.alternativeCreditScore;
  
  if (score >= 750) {
    this.riskCategory = 'low';
  } else if (score >= 600) {
    this.riskCategory = 'medium';
  } else {
    this.riskCategory = 'high';
  }
  
  return this.riskCategory;
};

// Generate loan recommendation
creditAnalysisSchema.methods.generateLoanRecommendation = function() {
  const score = this.alternativeCreditScore;
  const risk = this.riskCategory;
  
  let recommendation = {
    eligible: false,
    maxLoanAmount: 0,
    recommendedAmount: 0,
    suggestedInterestRate: 24.0,
    maxTenure: 6,
    conditions: []
  };
  
  if (score >= 600) {
    recommendation.eligible = true;
    
    // Loan amount based on score
    if (score >= 750) {
      recommendation.maxLoanAmount = 100000;
      recommendation.recommendedAmount = 50000;
      recommendation.suggestedInterestRate = 12.0;
      recommendation.maxTenure = 24;
    } else if (score >= 650) {
      recommendation.maxLoanAmount = 50000;
      recommendation.recommendedAmount = 25000;
      recommendation.suggestedInterestRate = 15.0;
      recommendation.maxTenure = 18;
    } else {
      recommendation.maxLoanAmount = 25000;
      recommendation.recommendedAmount = 15000;
      recommendation.suggestedInterestRate = 18.0;
      recommendation.maxTenure = 12;
    }
    
    // Add conditions based on risk factors
    if (this.redFlags.length > 0) {
      recommendation.conditions.push('Additional verification required');
    }
    
    if (risk === 'medium') {
      recommendation.conditions.push('Regular monitoring of repayment');
    }
  } else {
    recommendation.conditions.push('Credit score too low for loan approval');
    recommendation.conditions.push('Consider building credit history');
  }
  
  this.loanRecommendation = recommendation;
  return recommendation;
};

// Get analysis summary
creditAnalysisSchema.methods.getSummary = function() {
  return {
    creditScore: this.alternativeCreditScore,
    riskCategory: this.riskCategory,
    confidenceLevel: this.confidenceLevel,
    eligible: this.loanRecommendation.eligible,
    maxLoanAmount: this.loanRecommendation.maxLoanAmount,
    redFlagsCount: this.redFlags.length,
    positiveIndicatorsCount: this.positiveIndicators.length,
    analysisDate: this.analysisDate
  };
};

module.exports = mongoose.model('CreditAnalysis', creditAnalysisSchema);
