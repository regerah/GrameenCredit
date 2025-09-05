const NodeCache = require('node-cache');

// Create cache instances with different TTL for different types of data
const shortCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const mediumCache = new NodeCache({ stdTTL: 1800 }); // 30 minutes
const longCache = new NodeCache({ stdTTL: 3600 }); // 1 hour

// Cache middleware factory
const createCacheMiddleware = (cacheInstance, keyGenerator, ttl) => {
  return (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = keyGenerator ? keyGenerator(req) : `${req.originalUrl}_${req.user?.userId || 'anonymous'}`;
    
    // Check if data exists in cache
    const cachedData = cacheInstance.get(key);
    if (cachedData) {
      console.log(`Cache hit for key: ${key}`);
      return res.json({
        ...cachedData,
        cached: true,
        cacheTimestamp: new Date()
      });
    }

    // Store original res.json function
    const originalJson = res.json;
    
    // Override res.json to cache the response
    res.json = function(data) {
      // Only cache successful responses
      if (data.success !== false && res.statusCode < 400) {
        const cacheData = {
          ...data,
          cached: false
        };
        
        const cacheTTL = ttl || cacheInstance.options.stdTTL;
        cacheInstance.set(key, cacheData, cacheTTL);
        console.log(`Data cached for key: ${key}, TTL: ${cacheTTL}s`);
      }
      
      // Call original json function
      return originalJson.call(this, data);
    };

    next();
  };
};

// Specific cache middleware for different endpoints
const cacheUserProfile = createCacheMiddleware(
  mediumCache,
  (req) => `user_profile_${req.user.userId}`,
  1800 // 30 minutes
);

const cacheCreditScore = createCacheMiddleware(
  longCache,
  (req) => `credit_score_${req.user.userId}`,
  3600 // 1 hour
);

const cacheLoanEligibility = createCacheMiddleware(
  mediumCache,
  (req) => `loan_eligibility_${req.user.userId}`,
  900 // 15 minutes
);

const cacheDashboard = createCacheMiddleware(
  shortCache,
  (req) => `dashboard_${req.user.userId}`,
  300 // 5 minutes
);

// Cache invalidation helpers
const invalidateUserCache = (userId) => {
  const patterns = [
    `user_profile_${userId}`,
    `dashboard_${userId}`,
    `loan_eligibility_${userId}`,
    `credit_score_${userId}`
  ];
  
  patterns.forEach(pattern => {
    shortCache.del(pattern);
    mediumCache.del(pattern);
    longCache.del(pattern);
  });
  
  console.log(`Cache invalidated for user: ${userId}`);
};

const invalidateCreditCache = (userId) => {
  const patterns = [
    `credit_score_${userId}`,
    `loan_eligibility_${userId}`,
    `dashboard_${userId}`
  ];
  
  patterns.forEach(pattern => {
    mediumCache.del(pattern);
    longCache.del(pattern);
  });
  
  console.log(`Credit cache invalidated for user: ${userId}`);
};

// Offline data storage for low connectivity scenarios
class OfflineDataManager {
  constructor() {
    this.offlineQueue = new NodeCache({ stdTTL: 86400 }); // 24 hours
    this.syncQueue = new NodeCache({ stdTTL: 86400 }); // 24 hours
  }

  // Store data for offline access
  storeOfflineData(userId, dataType, data) {
    const key = `offline_${userId}_${dataType}`;
    this.offlineQueue.set(key, {
      data: data,
      timestamp: new Date(),
      synced: false
    });
    console.log(`Offline data stored: ${key}`);
  }

  // Get offline data
  getOfflineData(userId, dataType) {
    const key = `offline_${userId}_${dataType}`;
    return this.offlineQueue.get(key);
  }

  // Queue data for sync when online
  queueForSync(userId, action, data) {
    const syncKey = `sync_${userId}_${Date.now()}`;
    this.syncQueue.set(syncKey, {
      action: action,
      data: data,
      timestamp: new Date(),
      retryCount: 0
    });
    console.log(`Data queued for sync: ${syncKey}`);
  }

  // Get all pending sync items for a user
  getPendingSyncItems(userId) {
    const keys = this.syncQueue.keys();
    const userKeys = keys.filter(key => key.startsWith(`sync_${userId}_`));
    
    return userKeys.map(key => ({
      key: key,
      ...this.syncQueue.get(key)
    }));
  }

  // Mark sync item as completed
  markSyncCompleted(syncKey) {
    this.syncQueue.del(syncKey);
    console.log(`Sync completed: ${syncKey}`);
  }

  // Increment retry count for failed sync
  incrementRetryCount(syncKey) {
    const item = this.syncQueue.get(syncKey);
    if (item) {
      item.retryCount += 1;
      if (item.retryCount > 3) {
        // Remove after 3 failed attempts
        this.syncQueue.del(syncKey);
        console.log(`Sync item removed after max retries: ${syncKey}`);
      } else {
        this.syncQueue.set(syncKey, item);
        console.log(`Retry count incremented for: ${syncKey}`);
      }
    }
  }
}

const offlineManager = new OfflineDataManager();

// Middleware to handle offline scenarios
const offlineHandler = (req, res, next) => {
  // Store original res.json
  const originalJson = res.json;
  
  res.json = function(data) {
    // Store successful responses for offline access
    if (data.success && req.user?.userId) {
      const dataType = req.route?.path?.split('/').pop() || 'general';
      offlineManager.storeOfflineData(req.user.userId, dataType, data);
    }
    
    return originalJson.call(this, data);
  };

  // Check if this is a retry from offline queue
  if (req.headers['x-offline-retry'] === 'true') {
    console.log('Processing offline retry request');
  }

  next();
};

// Retry mechanism for failed requests
const retryMiddleware = (maxRetries = 3, retryDelay = 1000) => {
  return (req, res, next) => {
    let retryCount = 0;
    
    const originalSend = res.send;
    res.send = function(data) {
      // If request failed and we haven't exceeded max retries
      if (res.statusCode >= 500 && retryCount < maxRetries) {
        retryCount++;
        console.log(`Retrying request (${retryCount}/${maxRetries}): ${req.originalUrl}`);
        
        setTimeout(() => {
          // Reset response object for retry
          res.status(200);
          next();
        }, retryDelay * retryCount);
        
        return;
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = {
  shortCache,
  mediumCache,
  longCache,
  cacheUserProfile,
  cacheCreditScore,
  cacheLoanEligibility,
  cacheDashboard,
  invalidateUserCache,
  invalidateCreditCache,
  offlineManager,
  offlineHandler,
  retryMiddleware,
  createCacheMiddleware
};
