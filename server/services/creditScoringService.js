const CreditAnalysis = require('../models/CreditAnalysis');
const { analyzeSMSData } = require('./llmService');

// Main credit scoring function
const calculateAlternativeCreditScore = async (userId, userData) => {
  try {
    // Get or create credit analysis record
    let analysis = await CreditAnalysis.findOne({ userId });
    if (!analysis) {
      analysis = new CreditAnalysis({ userId });
    }

    // Analyze different data sources
    const smsAnalysis = await analyzeSMSTransactions(userData.smsData || []);
    const upiAnalysis = await analyzeUPITransactions(userData.upiData || []);
    const mobileAnalysis = await analyzeMobileUsage(userData.mobileData || []);

    // Update analysis with new data
    analysis.smsAnalysis = smsAnalysis;
    analysis.upiAnalysis = upiAnalysis;
    analysis.mobileUsage = mobileAnalysis;

    // Calculate component scores
    const components = calculateScoreComponents(smsAnalysis, upiAnalysis, mobileAnalysis, userData);
    analysis.creditScoreComponents = components;

    // Calculate final credit score
    const finalScore = analysis.calculateCreditScore();
    analysis.determineRiskCategory();

    // Generate recommendation
    analysis.generateLoanRecommendation();

    // Identify red flags and positive indicators
    analysis.redFlags = identifyRedFlags(smsAnalysis, upiAnalysis, mobileAnalysis);
    analysis.positiveIndicators = identifyPositiveIndicators(smsAnalysis, upiAnalysis, mobileAnalysis);

    // Set confidence level based on data quality
    analysis.confidenceLevel = calculateConfidenceLevel(smsAnalysis, upiAnalysis, mobileAnalysis);

    // Update metadata
    analysis.analysisDate = new Date();
    analysis.dataSourcesUsed = [
      { source: 'SMS', dataPoints: userData.smsData?.length || 0, dateRange: getSMSDateRange(userData.smsData) },
      { source: 'UPI', dataPoints: userData.upiData?.length || 0, dateRange: getUPIDateRange(userData.upiData) },
      { source: 'Mobile', dataPoints: userData.mobileData?.length || 0, dateRange: getMobileDateRange(userData.mobileData) }
    ];

    await analysis.save();

    return analysis;

  } catch (error) {
    console.error('Credit scoring error:', error);
    throw new Error('Failed to calculate credit score');
  }
};

// Analyze SMS transactions
const analyzeSMSTransactions = async (smsData) => {
  try {
    if (!smsData || smsData.length === 0) {
      return getDefaultSMSAnalysis();
    }

    const analysis = {
      totalTransactions: smsData.length,
      creditTransactions: 0,
      debitTransactions: 0,
      averageBalance: 0,
      balanceStability: 0,
      regularityScore: 0,
      merchantDiversity: 0,
      salaryCredits: [],
      recurringPayments: []
    };

    let totalBalance = 0;
    let balances = [];
    const merchants = new Set();
    const monthlyTransactions = {};

    // Process each SMS
    for (const sms of smsData) {
      const amount = parseAmount(sms.message);
      const type = determineTransactionType(sms.message);
      const merchant = extractMerchant(sms.message);

      if (type === 'credit') {
        analysis.creditTransactions++;
        
        // Check for salary patterns
        if (isSalaryCredit(sms.message, amount)) {
          analysis.salaryCredits.push({
            amount: amount,
            date: sms.date,
            source: merchant
          });
        }
      } else if (type === 'debit') {
        analysis.debitTransactions++;
      }

      // Track balance if available
      const balance = extractBalance(sms.message);
      if (balance !== null) {
        balances.push(balance);
        totalBalance += balance;
      }

      // Track merchants
      if (merchant) {
        merchants.add(merchant);
      }

      // Group by month for regularity analysis
      const month = sms.date.toISOString().substring(0, 7);
      monthlyTransactions[month] = (monthlyTransactions[month] || 0) + 1;
    }

    // Calculate metrics
    analysis.averageBalance = balances.length > 0 ? totalBalance / balances.length : 0;
    analysis.balanceStability = calculateBalanceStability(balances);
    analysis.regularityScore = calculateRegularityScore(monthlyTransactions);
    analysis.merchantDiversity = Math.min(merchants.size * 10, 100); // Scale to 0-100

    // Identify recurring payments
    analysis.recurringPayments = identifyRecurringPayments(smsData);

    return analysis;

  } catch (error) {
    console.error('SMS analysis error:', error);
    return getDefaultSMSAnalysis();
  }
};

// Analyze UPI transactions
const analyzeUPITransactions = async (upiData) => {
  try {
    if (!upiData || upiData.length === 0) {
      return getDefaultUPIAnalysis();
    }

    const analysis = {
      monthlyTransactionCount: 0,
      averageTransactionAmount: 0,
      totalVolume: 0,
      paymentRegularity: 0,
      digitalFootprintScore: 0,
      merchantCategories: [],
      peakTransactionHours: [],
      weekdayVsWeekendRatio: 0
    };

    let totalAmount = 0;
    const categories = {};
    const hourCounts = new Array(24).fill(0);
    let weekdayCount = 0;
    let weekendCount = 0;

    // Process UPI transactions
    for (const transaction of upiData) {
      totalAmount += transaction.amount;
      
      // Categorize merchant
      const category = categorizeMerchant(transaction.merchant);
      if (!categories[category]) {
        categories[category] = { count: 0, amount: 0 };
      }
      categories[category].count++;
      categories[category].amount += transaction.amount;

      // Track transaction timing
      const hour = transaction.timestamp.getHours();
      hourCounts[hour]++;

      const dayOfWeek = transaction.timestamp.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendCount++;
      } else {
        weekdayCount++;
      }
    }

    // Calculate metrics
    analysis.monthlyTransactionCount = Math.round(upiData.length / 3); // Assuming 3 months of data
    analysis.averageTransactionAmount = totalAmount / upiData.length;
    analysis.totalVolume = totalAmount;
    analysis.paymentRegularity = calculateUPIRegularity(upiData);
    analysis.digitalFootprintScore = Math.min(upiData.length * 2, 100);

    // Convert categories to array
    analysis.merchantCategories = Object.entries(categories).map(([category, data]) => ({
      category,
      transactionCount: data.count,
      totalAmount: data.amount
    }));

    // Find peak hours
    analysis.peakTransactionHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(item => item.hour);

    analysis.weekdayVsWeekendRatio = weekdayCount > 0 ? weekendCount / weekdayCount : 0;

    return analysis;

  } catch (error) {
    console.error('UPI analysis error:', error);
    return getDefaultUPIAnalysis();
  }
};

// Analyze mobile usage patterns
const analyzeMobileUsage = async (mobileData) => {
  try {
    if (!mobileData || mobileData.length === 0) {
      return getDefaultMobileAnalysis();
    }

    const analysis = {
      rechargeFrequency: 0,
      averageRechargeAmount: 0,
      planType: 'unknown',
      dataUsagePattern: 'medium',
      consistencyScore: 0
    };

    const recharges = mobileData.filter(item => item.type === 'recharge');
    
    if (recharges.length > 0) {
      const totalAmount = recharges.reduce((sum, r) => sum + r.amount, 0);
      analysis.averageRechargeAmount = totalAmount / recharges.length;
      analysis.rechargeFrequency = recharges.length;
      
      // Determine plan type based on patterns
      if (analysis.averageRechargeAmount > 500) {
        analysis.planType = 'postpaid';
      } else if (analysis.averageRechargeAmount < 100) {
        analysis.planType = 'prepaid';
      }

      // Calculate consistency
      analysis.consistencyScore = calculateRechargeConsistency(recharges);
    }

    return analysis;

  } catch (error) {
    console.error('Mobile analysis error:', error);
    return getDefaultMobileAnalysis();
  }
};

// Calculate score components with weights
const calculateScoreComponents = (smsAnalysis, upiAnalysis, mobileAnalysis, userData) => {
  return {
    transactionBehavior: {
      score: Math.round((smsAnalysis.regularityScore + upiAnalysis.paymentRegularity) / 2),
      weight: 0.25,
      factors: ['SMS regularity', 'UPI payment patterns']
    },
    paymentRegularity: {
      score: Math.round((smsAnalysis.balanceStability + mobileAnalysis.consistencyScore) / 2),
      weight: 0.20,
      factors: ['Balance stability', 'Recharge consistency']
    },
    digitalEngagement: {
      score: Math.round((upiAnalysis.digitalFootprintScore + smsAnalysis.merchantDiversity) / 2),
      weight: 0.20,
      factors: ['UPI usage', 'Merchant diversity']
    },
    financialStability: {
      score: calculateFinancialStabilityScore(smsAnalysis, userData),
      weight: 0.25,
      factors: ['Average balance', 'Income regularity']
    },
    socialSignals: {
      score: calculateSocialSignalsScore(upiAnalysis, mobileAnalysis),
      weight: 0.10,
      factors: ['Transaction timing', 'Usage patterns']
    }
  };
};

// Helper functions
const parseAmount = (message) => {
  const match = message.match(/Rs\.?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
};

const determineTransactionType = (message) => {
  if (message.toLowerCase().includes('credited') || message.toLowerCase().includes('received')) {
    return 'credit';
  } else if (message.toLowerCase().includes('debited') || message.toLowerCase().includes('paid')) {
    return 'debit';
  }
  return 'unknown';
};

const extractBalance = (message) => {
  const match = message.match(/balance.*?Rs\.?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
};

const calculateBalanceStability = (balances) => {
  if (balances.length < 2) return 50;
  
  const mean = balances.reduce((a, b) => a + b, 0) / balances.length;
  const variance = balances.reduce((sum, balance) => sum + Math.pow(balance - mean, 2), 0) / balances.length;
  const coefficient = Math.sqrt(variance) / mean;
  
  return Math.max(0, Math.min(100, 100 - (coefficient * 100)));
};

const calculateRegularityScore = (monthlyTransactions) => {
  const months = Object.keys(monthlyTransactions);
  if (months.length < 2) return 30;
  
  const counts = Object.values(monthlyTransactions);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
  
  return Math.max(0, Math.min(100, 100 - (Math.sqrt(variance) / mean * 50)));
};

// Default analysis functions
const getDefaultSMSAnalysis = () => ({
  totalTransactions: 0,
  creditTransactions: 0,
  debitTransactions: 0,
  averageBalance: 0,
  balanceStability: 30,
  regularityScore: 30,
  merchantDiversity: 20,
  salaryCredits: [],
  recurringPayments: []
});

const getDefaultUPIAnalysis = () => ({
  monthlyTransactionCount: 0,
  averageTransactionAmount: 0,
  totalVolume: 0,
  paymentRegularity: 30,
  digitalFootprintScore: 20,
  merchantCategories: [],
  peakTransactionHours: [],
  weekdayVsWeekendRatio: 0
});

const getDefaultMobileAnalysis = () => ({
  rechargeFrequency: 0,
  averageRechargeAmount: 0,
  planType: 'unknown',
  dataUsagePattern: 'low',
  consistencyScore: 30
});

// Additional helper functions
const identifyRedFlags = (smsAnalysis, upiAnalysis, mobileAnalysis) => {
  const flags = [];
  
  if (smsAnalysis.balanceStability < 30) {
    flags.push({
      type: 'low_balance_stability',
      severity: 'high',
      description: 'Highly volatile account balance',
      impact: -20
    });
  }
  
  if (upiAnalysis.digitalFootprintScore < 20) {
    flags.push({
      type: 'low_digital_usage',
      severity: 'medium',
      description: 'Limited digital payment activity',
      impact: -10
    });
  }
  
  return flags;
};

const identifyPositiveIndicators = (smsAnalysis, upiAnalysis, mobileAnalysis) => {
  const indicators = [];
  
  if (smsAnalysis.salaryCredits.length > 0) {
    indicators.push({
      type: 'regular_salary',
      strength: 'high',
      description: 'Regular salary credits detected',
      impact: 25
    });
  }
  
  if (upiAnalysis.digitalFootprintScore > 70) {
    indicators.push({
      type: 'high_digital_engagement',
      strength: 'medium',
      description: 'Strong digital payment adoption',
      impact: 15
    });
  }
  
  return indicators;
};

const calculateConfidenceLevel = (smsAnalysis, upiAnalysis, mobileAnalysis) => {
  let confidence = 0.3; // Base confidence
  
  if (smsAnalysis.totalTransactions > 50) confidence += 0.2;
  if (upiAnalysis.monthlyTransactionCount > 10) confidence += 0.2;
  if (mobileAnalysis.rechargeFrequency > 5) confidence += 0.1;
  
  return Math.min(confidence, 1.0);
};

module.exports = {
  calculateAlternativeCreditScore,
  analyzeSMSTransactions,
  analyzeUPITransactions,
  analyzeMobileUsage
};
