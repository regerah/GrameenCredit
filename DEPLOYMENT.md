# GrameenCredit Deployment Guide

## Overview
This guide covers the deployment of GrameenCredit - an AI-enabled loan underwriting app for rural India with voice-first interface and alternative credit scoring.

## Prerequisites

### System Requirements
- Node.js 16+ 
- MongoDB 4.4+
- Redis (optional, for production caching)
- React Native development environment
- Android Studio / Xcode for mobile builds

### External Services
- OpenAI API account (GPT-3.5/4 for LLM services)
- Google Cloud Platform (Speech-to-Text, Text-to-Speech)
- Twilio account (SMS services)
- Cloud storage (AWS S3/Google Cloud Storage)

## Environment Setup

### 1. Backend Deployment

#### Production Environment Variables
```bash
# Server Configuration
NODE_ENV=production
PORT=3000

# Database
MONGODB_URI=mongodb://your-mongodb-host:27017/grameencredit

# Authentication
JWT_SECRET=your-super-secure-jwt-secret-min-32-chars
JWT_EXPIRES_IN=7d

# AI Services
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-3.5-turbo

# Google Cloud Services
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# SMS Services
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Encryption
ENCRYPTION_KEY=your-32-character-encryption-key-here
ENCRYPTION_ALGORITHM=aes-256-gcm

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Upload
MAX_FILE_SIZE=5242880
UPLOAD_PATH=./uploads

# Verification APIs
AADHAAR_VERIFICATION_URL=https://api.example.com/verify-aadhaar
PAN_VERIFICATION_URL=https://api.example.com/verify-pan
VERIFICATION_API_KEY=your-verification-api-key

# Loan Configuration
MIN_LOAN_AMOUNT=5000
MAX_LOAN_AMOUNT=100000
DEFAULT_INTEREST_RATE=12.5
MAX_LOAN_TENURE_MONTHS=24
```

#### Docker Deployment
```dockerfile
# Dockerfile
FROM node:16-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongo:27017/grameencredit
    depends_on:
      - mongo
      - redis
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    restart: unless-stopped

  mongo:
    image: mongo:4.4
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  mongo_data:
```

#### Kubernetes Deployment
```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grameencredit-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: grameencredit-backend
  template:
    metadata:
      labels:
        app: grameencredit-backend
    spec:
      containers:
      - name: backend
        image: grameencredit/backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: grameencredit-secrets
              key: mongodb-uri
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: grameencredit-backend-service
spec:
  selector:
    app: grameencredit-backend
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

### 2. Mobile App Deployment

#### Android Build
```bash
# Generate signed APK
cd client/android
./gradlew assembleRelease

# Generate AAB for Play Store
./gradlew bundleRelease
```

#### iOS Build
```bash
# Build for App Store
cd client/ios
xcodebuild -workspace GrameenCredit.xcworkspace \
           -scheme GrameenCredit \
           -configuration Release \
           -archivePath GrameenCredit.xcarchive \
           archive
```

#### React Native Configuration
```javascript
// client/src/config/environment.js
const config = {
  development: {
    API_BASE_URL: 'http://localhost:3000/api',
    VOICE_ENABLED: true,
    OFFLINE_ENABLED: true,
  },
  production: {
    API_BASE_URL: 'https://api.grameencredit.com/api',
    VOICE_ENABLED: true,
    OFFLINE_ENABLED: true,
  }
};

export default config[__DEV__ ? 'development' : 'production'];
```

## Security Configuration

### SSL/TLS Setup
```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name api.grameencredit.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Firewall Rules
```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw deny 3000/tcp   # Block direct access to app
ufw enable
```

## Monitoring & Logging

### Application Monitoring
```javascript
// server/middleware/monitoring.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

### Health Checks
```javascript
// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version,
    checks: {}
  };

  // Database check
  try {
    await mongoose.connection.db.admin().ping();
    health.checks.database = 'OK';
  } catch (error) {
    health.checks.database = 'FAIL';
    health.status = 'DEGRADED';
  }

  // External services check
  try {
    // Check OpenAI API
    health.checks.openai = 'OK';
    // Check Twilio
    health.checks.twilio = 'OK';
  } catch (error) {
    health.checks.external_services = 'DEGRADED';
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

## Performance Optimization

### Database Indexing
```javascript
// Create indexes for better performance
db.users.createIndex({ phoneNumber: 1 }, { unique: true });
db.users.createIndex({ aadhaarNumber: 1 }, { unique: true });
db.users.createIndex({ panNumber: 1 }, { unique: true });
db.loans.createIndex({ userId: 1 });
db.loans.createIndex({ status: 1 });
db.loans.createIndex({ applicationDate: -1 });
db.creditanalyses.createIndex({ userId: 1 });
db.creditanalyses.createIndex({ analysisDate: -1 });
```

### Caching Strategy
```javascript
// Redis caching configuration
const redis = require('redis');
const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

// Cache user profiles for 30 minutes
const cacheUserProfile = async (userId, data) => {
  await client.setex(`user:${userId}`, 1800, JSON.stringify(data));
};
```

## Backup & Recovery

### Database Backup
```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
DB_NAME="grameencredit"

# Create backup
mongodump --host localhost:27017 --db $DB_NAME --out $BACKUP_DIR/$DATE

# Compress backup
tar -czf $BACKUP_DIR/grameencredit_$DATE.tar.gz -C $BACKUP_DIR $DATE

# Remove uncompressed backup
rm -rf $BACKUP_DIR/$DATE

# Keep only last 7 days of backups
find $BACKUP_DIR -name "grameencredit_*.tar.gz" -mtime +7 -delete
```

### Automated Backup Cron
```bash
# Add to crontab
0 2 * * * /path/to/backup.sh >> /var/log/backup.log 2>&1
```

## Scaling Considerations

### Load Balancing
```nginx
# nginx load balancer
upstream grameencredit_backend {
    server app1:3000 weight=3;
    server app2:3000 weight=2;
    server app3:3000 weight=1;
}

server {
    location / {
        proxy_pass http://grameencredit_backend;
    }
}
```

### Auto-scaling (Kubernetes)
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: grameencredit-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: grameencredit-backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Deployment Checklist

### Pre-deployment
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Database migrations completed
- [ ] External service credentials verified
- [ ] Security configurations applied
- [ ] Backup strategy implemented

### Post-deployment
- [ ] Health checks passing
- [ ] Monitoring alerts configured
- [ ] Log aggregation working
- [ ] Performance metrics baseline established
- [ ] Security scan completed
- [ ] Load testing performed

### Mobile App Store Deployment
- [ ] App store metadata prepared
- [ ] Screenshots and descriptions ready
- [ ] Privacy policy and terms of service updated
- [ ] App signing certificates configured
- [ ] Beta testing completed
- [ ] Store review guidelines compliance verified

## Troubleshooting

### Common Issues
1. **Database Connection Errors**
   - Check MongoDB service status
   - Verify connection string
   - Check firewall rules

2. **Voice Service Failures**
   - Verify Google Cloud credentials
   - Check API quotas and billing
   - Test microphone permissions

3. **SMS Delivery Issues**
   - Verify Twilio credentials
   - Check phone number format
   - Review SMS content for compliance

4. **High Memory Usage**
   - Monitor for memory leaks
   - Optimize image processing
   - Implement proper caching

### Log Analysis
```bash
# Monitor application logs
tail -f logs/combined.log | grep ERROR

# Check system resources
htop
df -h
free -m

# Monitor network connections
netstat -tulpn | grep :3000
```

## Support & Maintenance

### Regular Maintenance Tasks
- Weekly security updates
- Monthly dependency updates  
- Quarterly performance reviews
- Annual security audits

### Emergency Contacts
- DevOps Team: devops@grameencredit.com
- Security Team: security@grameencredit.com
- On-call Engineer: +91-XXXXXXXXXX

For detailed technical support, refer to the main README.md file.
