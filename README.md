# GrameenCredit - AI-Enabled Loan Underwriting App

## Overview
GrameenCredit is an AI-powered loan underwriting and lending application designed specifically for rural and semi-urban India. The app provides instant personal loans through a voice-first interface optimized for low digital literacy users and low-bandwidth environments.

## Key Features

### 🎤 Voice-First Experience
- Multilingual Voice Loan Assistant (Hindi, Tamil, Telugu, and more)
- Audio confirmations for loan terms and conditions
- Step-by-step guidance in local languages

### 🧠 AI-Powered Credit Scoring
- Alternative credit scoring using SMS transaction analysis
- UPI payment pattern recognition
- Mobile recharge behavior analysis
- Enables lending to "thin-file" customers without formal banking history

### 📱 Low-Bandwidth Optimized
- Local caching for offline functionality
- Retry and resume logic for poor connectivity
- SMS fallback for loan status and EMI reminders
- Lightweight UI optimized for low-spec smartphones

### 🔒 Security & Trust
- Aadhaar/PAN verification with encrypted storage
- Consent-based data access
- OTP + device binding authentication
- End-to-end encryption (AES-256)

## Target Users
- Farmers, small shopkeepers, gig workers
- Self-employed individuals in tier-2, tier-3 towns and villages
- Users with limited formal credit history
- People with low digital literacy

## Tech Stack

### Backend
- Node.js with Express
- MongoDB for data storage
- OpenAI GPT for LLM services
- Google Cloud Speech-to-Text & Text-to-Speech
- Twilio for SMS services

### Frontend (Mobile)
- React Native for cross-platform mobile app
- Voice recognition and synthesis
- Offline-first architecture

### AI/ML Services
- Alternative credit scoring engine
- SMS transaction parsing
- Risk assessment algorithms
- Fraud detection

## Installation

### Prerequisites
- Node.js (v16 or higher)
- MongoDB
- React Native development environment
- Google Cloud Platform account
- OpenAI API key
- Twilio account

### Backend Setup
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys and configuration

# Start the server
npm run dev
```

### Mobile App Setup
```bash
# Install React Native dependencies
npm run install-client

# Start the mobile app (requires React Native CLI)
npm run client
```

## Environment Variables
```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/grameencredit
JWT_SECRET=your_jwt_secret
OPENAI_API_KEY=your_openai_key
GOOGLE_CLOUD_PROJECT_ID=your_gcp_project
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
ENCRYPTION_KEY=your_encryption_key
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-otp` - OTP verification

### Loan Services
- `POST /api/loans/apply` - Submit loan application
- `GET /api/loans/status/:id` - Check loan status
- `POST /api/loans/voice-assist` - Voice assistant interaction

### Credit Scoring
- `POST /api/credit/analyze-sms` - Analyze SMS data for credit scoring
- `POST /api/credit/score` - Generate credit score
- `GET /api/credit/report/:userId` - Get credit report

### Voice Services
- `POST /api/voice/speech-to-text` - Convert speech to text
- `POST /api/voice/text-to-speech` - Convert text to speech
- `POST /api/voice/process-command` - Process voice commands

## Security Features
- Data encryption at rest and in transit
- Consent management for data access
- Regular security audits
- Bias detection in AI models
- Device binding for authentication

## Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License
MIT License - see LICENSE file for details

## Support
For support and questions, contact: ashutoshtripathi03022004@gmail.com
