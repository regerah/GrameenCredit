const { offlineManager } = require('../middleware/cache');
const axios = require('axios');

// Sync service for handling offline data synchronization
class SyncService {
  constructor() {
    this.isOnline = true;
    this.syncInterval = null;
    this.retryDelay = 5000; // 5 seconds
  }

  // Start periodic sync
  startPeriodicSync(intervalMs = 30000) { // 30 seconds
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      this.syncPendingData();
    }, intervalMs);

    console.log(`Periodic sync started with interval: ${intervalMs}ms`);
  }

  // Stop periodic sync
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Periodic sync stopped');
    }
  }

  // Check network connectivity
  async checkConnectivity() {
    try {
      const response = await axios.get('/health', { timeout: 5000 });
      this.isOnline = response.status === 200;
      return this.isOnline;
    } catch (error) {
      this.isOnline = false;
      return false;
    }
  }

  // Sync all pending data
  async syncPendingData() {
    if (!await this.checkConnectivity()) {
      console.log('No connectivity - skipping sync');
      return;
    }

    // Get all users with pending sync items
    const allKeys = offlineManager.syncQueue.keys();
    const userIds = [...new Set(allKeys.map(key => key.split('_')[1]))];

    for (const userId of userIds) {
      await this.syncUserData(userId);
    }
  }

  // Sync data for specific user
  async syncUserData(userId) {
    const pendingItems = offlineManager.getPendingSyncItems(userId);
    
    if (pendingItems.length === 0) {
      return;
    }

    console.log(`Syncing ${pendingItems.length} items for user: ${userId}`);

    for (const item of pendingItems) {
      try {
        await this.processSyncItem(item);
        offlineManager.markSyncCompleted(item.key);
      } catch (error) {
        console.error(`Sync failed for item ${item.key}:`, error);
        offlineManager.incrementRetryCount(item.key);
      }
    }
  }

  // Process individual sync item
  async processSyncItem(item) {
    const { action, data } = item;

    switch (action) {
      case 'loan_application':
        return await this.syncLoanApplication(data);
      case 'profile_update':
        return await this.syncProfileUpdate(data);
      case 'document_upload':
        return await this.syncDocumentUpload(data);
      case 'emi_payment':
        return await this.syncEMIPayment(data);
      default:
        console.warn(`Unknown sync action: ${action}`);
    }
  }

  // Sync loan application
  async syncLoanApplication(data) {
    const response = await axios.post('/api/loans/apply', data, {
      headers: {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  // Sync profile update
  async syncProfileUpdate(data) {
    const response = await axios.put('/api/user/profile', data.profileData, {
      headers: {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  // Sync document upload
  async syncDocumentUpload(data) {
    const formData = new FormData();
    formData.append('documents', data.document);
    formData.append('documentTypes', data.documentType);

    const response = await axios.post(`/api/loans/${data.loanId}/documents`, formData, {
      headers: {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  }

  // Sync EMI payment
  async syncEMIPayment(data) {
    const response = await axios.post(`/api/loans/${data.loanId}/pay-emi`, data.paymentData, {
      headers: {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  // Handle offline request
  handleOfflineRequest(req, res, next) {
    if (!this.isOnline && req.method !== 'GET') {
      // Queue non-GET requests for later sync
      const syncData = {
        url: req.originalUrl,
        method: req.method,
        body: req.body,
        headers: req.headers,
        userId: req.user?.userId
      };

      offlineManager.queueForSync(req.user?.userId, 'api_request', syncData);

      return res.status(202).json({
        success: true,
        message: 'Request queued for sync when online',
        offline: true,
        queuedAt: new Date()
      });
    }

    next();
  }

  // Get sync status for user
  getSyncStatus(userId) {
    const pendingItems = offlineManager.getPendingSyncItems(userId);
    
    return {
      isOnline: this.isOnline,
      pendingSync: pendingItems.length,
      lastSyncAttempt: new Date(),
      items: pendingItems.map(item => ({
        action: item.action,
        timestamp: item.timestamp,
        retryCount: item.retryCount
      }))
    };
  }
}

// Bandwidth optimization utilities
class BandwidthOptimizer {
  constructor() {
    this.compressionEnabled = true;
    this.imageQuality = 0.7; // 70% quality for images
  }

  // Compress response data
  compressResponse(data) {
    if (!this.compressionEnabled) return data;

    // Remove unnecessary fields for mobile
    if (data.data) {
      return {
        ...data,
        data: this.optimizeDataForMobile(data.data)
      };
    }

    return data;
  }

  // Optimize data structure for mobile
  optimizeDataForMobile(data) {
    // Remove verbose fields, keep only essential data
    const optimized = { ...data };

    // Remove timestamps older than 30 days for lists
    if (Array.isArray(optimized)) {
      return optimized.map(item => this.removeOldTimestamps(item));
    }

    if (typeof optimized === 'object') {
      return this.removeOldTimestamps(optimized);
    }

    return optimized;
  }

  // Remove old timestamps to reduce payload
  removeOldTimestamps(obj) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cleaned = { ...obj };

    Object.keys(cleaned).forEach(key => {
      if (key.includes('Date') || key.includes('Timestamp')) {
        const date = new Date(cleaned[key]);
        if (date < thirtyDaysAgo && key !== 'createdAt') {
          delete cleaned[key];
        }
      }
    });

    return cleaned;
  }

  // Optimize images for low bandwidth
  optimizeImage(imageBuffer, format = 'jpeg') {
    // In production, use image processing library like Sharp
    // For now, return original buffer
    return imageBuffer;
  }

  // Create pagination for large datasets
  paginateData(data, page = 1, limit = 10) {
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    if (Array.isArray(data)) {
      return {
        data: data.slice(startIndex, endIndex),
        pagination: {
          page: page,
          limit: limit,
          total: data.length,
          pages: Math.ceil(data.length / limit),
          hasNext: endIndex < data.length,
          hasPrev: page > 1
        }
      };
    }

    return { data, pagination: null };
  }
}

// SMS fallback service for critical notifications
class SMSFallbackService {
  constructor() {
    this.criticalActions = [
      'loan_approved',
      'loan_rejected',
      'emi_due',
      'emi_overdue',
      'account_locked'
    ];
  }

  // Check if action requires SMS fallback
  requiresSMSFallback(action, userConnectivity = 'online') {
    return this.criticalActions.includes(action) || userConnectivity === 'offline';
  }

  // Send SMS notification as fallback
  async sendSMSFallback(phoneNumber, action, data, language = 'english') {
    const { sendLoanStatusSMS, sendEMIReminderSMS } = require('./smsService');

    try {
      switch (action) {
        case 'loan_approved':
        case 'loan_rejected':
          return await sendLoanStatusSMS(phoneNumber, data.loanId, action, language);
        
        case 'emi_due':
        case 'emi_overdue':
          return await sendEMIReminderSMS(phoneNumber, data, language);
        
        default:
          console.log(`No SMS fallback configured for action: ${action}`);
      }
    } catch (error) {
      console.error('SMS fallback failed:', error);
      throw error;
    }
  }

  // Queue SMS for sending when connectivity improves
  queueSMSFallback(phoneNumber, action, data, language) {
    offlineManager.queueForSync('system', 'sms_fallback', {
      phoneNumber,
      action,
      data,
      language,
      priority: 'high'
    });
  }
}

// Initialize services
const syncService = new SyncService();
const bandwidthOptimizer = new BandwidthOptimizer();
const smsFallbackService = new SMSFallbackService();

// Start periodic sync
syncService.startPeriodicSync(30000); // 30 seconds

module.exports = {
  syncService,
  bandwidthOptimizer,
  smsFallbackService,
  SyncService,
  BandwidthOptimizer,
  SMSFallbackService
};
