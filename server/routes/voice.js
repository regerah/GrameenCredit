const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { processVoiceCommand, speechToText, textToSpeech } = require('../services/voiceService');
const { getLoanAssistantResponse } = require('../services/llmService');

const router = express.Router();

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

// Convert speech to text
router.post('/speech-to-text', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Audio file is required'
      });
    }

    const { language = 'hi-IN' } = req.body;
    const audioBuffer = req.file.buffer;

    const transcription = await speechToText(audioBuffer, language);

    res.json({
      success: true,
      data: {
        transcription,
        language,
        confidence: transcription.confidence || 0.9
      }
    });

  } catch (error) {
    console.error('Speech-to-text error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert speech to text',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Convert text to speech
router.post('/text-to-speech', authenticateToken, async (req, res) => {
  try {
    const { text, language = 'hi-IN', gender = 'FEMALE', speed = 1.0 } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }

    const audioBuffer = await textToSpeech(text, {
      language,
      gender,
      speed: req.user.userData.voiceSpeed || speed
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': 'attachment; filename="speech.mp3"'
    });

    res.send(audioBuffer);

  } catch (error) {
    console.error('Text-to-speech error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert text to speech',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Process voice command for loan assistant
router.post('/loan-assistant', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    let userInput;
    const { language = 'hindi', context = 'general' } = req.body;

    // Handle both audio and text input
    if (req.file) {
      const audioBuffer = req.file.buffer;
      const languageCode = language === 'hindi' ? 'hi-IN' : 'en-IN';
      const transcription = await speechToText(audioBuffer, languageCode);
      userInput = transcription.text;
    } else if (req.body.text) {
      userInput = req.body.text;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either audio file or text input is required'
      });
    }

    // Get user context
    const userContext = {
      userId: req.user.userId,
      name: req.user.userData.name,
      preferredLanguage: req.user.userData.preferredLanguage,
      aadhaarVerified: req.user.userData.aadhaarVerified,
      panVerified: req.user.userData.panVerified,
      creditScore: req.user.userData.creditScore,
      currentLoanAmount: req.user.userData.currentLoanAmount,
      isEligibleForLoan: req.user.userData.isEligibleForLoan(),
      occupation: req.user.userData.occupation,
      monthlyIncome: req.user.userData.monthlyIncome
    };

    // Process the command with LLM
    const assistantResponse = await getLoanAssistantResponse(userInput, userContext, context);

    // Convert response to speech if voice is enabled
    let audioResponse = null;
    if (req.user.userData.voiceEnabled) {
      const languageCode = language === 'hindi' ? 'hi-IN' : 'en-IN';
      audioResponse = await textToSpeech(assistantResponse.text, {
        language: languageCode,
        gender: 'FEMALE',
        speed: req.user.userData.voiceSpeed || 1.0
      });
    }

    res.json({
      success: true,
      data: {
        userInput,
        response: assistantResponse,
        audioAvailable: !!audioResponse,
        language,
        context
      }
    });

    // If audio response was generated, provide endpoint to download it
    if (audioResponse) {
      // Store audio temporarily (in production, use cloud storage)
      req.session = req.session || {};
      req.session.lastAudioResponse = audioResponse;
    }

  } catch (error) {
    console.error('Voice assistant error:', error);
    res.status(500).json({
      success: false,
      message: 'Voice assistant failed to process request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get audio response from last interaction
router.get('/audio-response', authenticateToken, (req, res) => {
  try {
    const audioBuffer = req.session?.lastAudioResponse;
    
    if (!audioBuffer) {
      return res.status(404).json({
        success: false,
        message: 'No audio response available'
      });
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': 'attachment; filename="assistant-response.mp3"'
    });

    res.send(audioBuffer);

    // Clear the audio after sending
    delete req.session.lastAudioResponse;

  } catch (error) {
    console.error('Audio response error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audio response'
    });
  }
});

// Voice-guided loan application flow
router.post('/guided-application', authenticateToken, async (req, res) => {
  try {
    const { step, userResponse, language = 'hindi' } = req.body;

    const applicationSteps = {
      welcome: {
        prompt: language === 'hindi' 
          ? 'नमस्ते! GrameenCredit में आपका स्वागत है। क्या आप लोन के लिए आवेदन करना चाहते हैं?'
          : 'Hello! Welcome to GrameenCredit. Would you like to apply for a loan?',
        nextStep: 'loan_amount',
        options: ['हाँ', 'नहीं', 'yes', 'no']
      },
      loan_amount: {
        prompt: language === 'hindi'
          ? 'आपको कितनी राशि की आवश्यकता है? कृपया 5,000 से 1,00,000 रुपये के बीच बताएं।'
          : 'How much amount do you need? Please specify between Rs. 5,000 to Rs. 1,00,000.',
        nextStep: 'loan_purpose',
        validation: (amount) => amount >= 5000 && amount <= 100000
      },
      loan_purpose: {
        prompt: language === 'hindi'
          ? 'लोन का उद्देश्य क्या है? कृषि, व्यापार, शिक्षा, चिकित्सा, या व्यक्तिगत?'
          : 'What is the purpose of the loan? Agriculture, Business, Education, Medical, or Personal?',
        nextStep: 'tenure',
        options: ['agriculture', 'business', 'education', 'medical', 'personal']
      },
      tenure: {
        prompt: language === 'hindi'
          ? 'आप कितने महीनों में लोन चुकाना चाहते हैं? 3 से 24 महीने के बीच चुनें।'
          : 'In how many months do you want to repay the loan? Choose between 3 to 24 months.',
        nextStep: 'confirmation',
        validation: (months) => months >= 3 && months <= 24
      },
      confirmation: {
        prompt: language === 'hindi'
          ? 'कृपया अपनी जानकारी की पुष्टि करें। क्या आप आवेदन जमा करना चाहते हैं?'
          : 'Please confirm your information. Do you want to submit the application?',
        nextStep: 'complete',
        options: ['हाँ', 'नहीं', 'yes', 'no']
      }
    };

    const currentStep = applicationSteps[step];
    if (!currentStep) {
      return res.status(400).json({
        success: false,
        message: 'Invalid application step'
      });
    }

    // Generate audio for the prompt
    let audioPrompt = null;
    if (req.user.userData.voiceEnabled) {
      const languageCode = language === 'hindi' ? 'hi-IN' : 'en-IN';
      audioPrompt = await textToSpeech(currentStep.prompt, {
        language: languageCode,
        gender: 'FEMALE',
        speed: req.user.userData.voiceSpeed || 1.0
      });
    }

    res.json({
      success: true,
      data: {
        step,
        prompt: currentStep.prompt,
        nextStep: currentStep.nextStep,
        options: currentStep.options,
        audioAvailable: !!audioPrompt,
        language
      }
    });

    // Store audio temporarily
    if (audioPrompt) {
      req.session = req.session || {};
      req.session.lastAudioResponse = audioPrompt;
    }

  } catch (error) {
    console.error('Guided application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process guided application',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Voice settings update
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const { voiceEnabled, voiceSpeed, preferredLanguage } = req.body;

    const updateData = {};
    if (typeof voiceEnabled === 'boolean') {
      updateData.voiceEnabled = voiceEnabled;
    }
    if (voiceSpeed && voiceSpeed >= 0.5 && voiceSpeed <= 2.0) {
      updateData.voiceSpeed = voiceSpeed;
    }
    if (preferredLanguage) {
      updateData.preferredLanguage = preferredLanguage;
    }

    await req.user.userData.updateOne(updateData);

    res.json({
      success: true,
      message: 'Voice settings updated successfully',
      data: updateData
    });

  } catch (error) {
    console.error('Voice settings update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update voice settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
