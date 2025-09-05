const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  // Loan Identification
  loanId: {
    type: String,
    unique: true,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Loan Details
  amount: {
    type: Number,
    required: true,
    min: 5000,
    max: 100000
  },
  interestRate: {
    type: Number,
    required: true,
    min: 8.0,
    max: 24.0
  },
  tenure: {
    type: Number,
    required: true,
    min: 3,
    max: 24
  },
  purpose: {
    type: String,
    enum: ['agriculture', 'business', 'education', 'medical', 'personal', 'emergency'],
    required: true
  },
  
  // EMI Details
  emiAmount: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  
  // Application Status
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected', 'disbursed', 'closed'],
    default: 'pending'
  },
  applicationDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: Date,
  disbursalDate: Date,
  
  // Credit Assessment
  creditScore: {
    type: Number,
    min: 300,
    max: 900
  },
  riskScore: {
    type: Number,
    min: 0,
    max: 100
  },
  alternativeCreditData: {
    smsAnalysis: {
      transactionCount: Number,
      averageBalance: Number,
      regularityScore: Number,
      merchantDiversity: Number
    },
    upiAnalysis: {
      monthlyTransactions: Number,
      averageTransactionAmount: Number,
      paymentRegularity: Number,
      digitalFootprint: Number
    },
    mobileUsage: {
      rechargeFrequency: Number,
      averageRechargeAmount: Number,
      planType: String
    }
  },
  
  // Decision Details
  approvalReason: String,
  rejectionReason: String,
  aiDecisionConfidence: {
    type: Number,
    min: 0,
    max: 1
  },
  
  // Repayment Details
  repaymentSchedule: [{
    emiNumber: Number,
    dueDate: Date,
    amount: Number,
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'partial'],
      default: 'pending'
    },
    paidDate: Date,
    paidAmount: Number
  }],
  
  // Communication Preferences
  reminderPreferences: {
    voice: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: true
    },
    push: {
      type: Boolean,
      default: true
    },
    daysBefore: {
      type: Number,
      default: 3
    }
  },
  
  // Voice Interaction History
  voiceInteractions: [{
    timestamp: Date,
    type: {
      type: String,
      enum: ['application', 'query', 'reminder', 'payment']
    },
    language: String,
    duration: Number,
    transcript: String,
    response: String
  }],
  
  // Documents
  documents: [{
    type: {
      type: String,
      enum: ['aadhaar', 'pan', 'income_proof', 'bank_statement', 'photo']
    },
    filename: String,
    uploadDate: Date,
    verified: {
      type: Boolean,
      default: false
    }
  }],
  
  // Audit Trail
  statusHistory: [{
    status: String,
    timestamp: Date,
    reason: String,
    updatedBy: String
  }]
}, {
  timestamps: true
});

// Indexes for performance
loanSchema.index({ userId: 1 });
loanSchema.index({ loanId: 1 });
loanSchema.index({ status: 1 });
loanSchema.index({ applicationDate: -1 });
loanSchema.index({ 'repaymentSchedule.dueDate': 1 });

// Generate unique loan ID
loanSchema.pre('save', async function(next) {
  if (!this.loanId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.loanId = `GC${timestamp}${random}`.toUpperCase();
  }
  next();
});

// Calculate EMI amount
loanSchema.methods.calculateEMI = function() {
  const principal = this.amount;
  const rate = this.interestRate / 100 / 12; // Monthly interest rate
  const tenure = this.tenure;
  
  const emi = (principal * rate * Math.pow(1 + rate, tenure)) / 
              (Math.pow(1 + rate, tenure) - 1);
  
  this.emiAmount = Math.round(emi);
  this.totalAmount = Math.round(emi * tenure);
  
  return this.emiAmount;
};

// Generate repayment schedule
loanSchema.methods.generateRepaymentSchedule = function() {
  const schedule = [];
  const startDate = this.disbursalDate || new Date();
  
  for (let i = 1; i <= this.tenure; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    
    schedule.push({
      emiNumber: i,
      dueDate: dueDate,
      amount: this.emiAmount,
      status: 'pending'
    });
  }
  
  this.repaymentSchedule = schedule;
  return schedule;
};

// Get next EMI due
loanSchema.methods.getNextEMI = function() {
  return this.repaymentSchedule.find(emi => emi.status === 'pending');
};

// Get overdue EMIs
loanSchema.methods.getOverdueEMIs = function() {
  const today = new Date();
  return this.repaymentSchedule.filter(emi => 
    emi.status === 'pending' && emi.dueDate < today
  );
};

// Check if loan is eligible for closure
loanSchema.methods.canBeClosed = function() {
  return this.repaymentSchedule.every(emi => emi.status === 'paid');
};

// Add status to history
loanSchema.methods.addStatusHistory = function(status, reason, updatedBy = 'system') {
  this.statusHistory.push({
    status: status,
    timestamp: new Date(),
    reason: reason,
    updatedBy: updatedBy
  });
  this.status = status;
};

module.exports = mongoose.model('Loan', loanSchema);
