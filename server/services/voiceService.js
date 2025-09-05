const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;

// Initialize Google Cloud clients
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// Convert speech to text
const speechToText = async (audioBuffer, languageCode = 'hi-IN') => {
  try {
    const request = {
      audio: {
        content: audioBuffer.toString('base64'),
      },
      config: {
        encoding: 'WEBM_OPUS', // Common format for web audio
        sampleRateHertz: 16000,
        languageCode: languageCode,
        alternativeLanguageCodes: ['en-IN', 'hi-IN'],
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        model: 'latest_long', // Better for longer audio
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    const confidence = response.results.length > 0 
      ? response.results[0].alternatives[0].confidence 
      : 0;

    return {
      text: transcription,
      confidence: confidence,
      languageCode: languageCode
    };

  } catch (error) {
    console.error('Speech-to-text error:', error);
    
    // Fallback for development
    if (process.env.NODE_ENV === 'development') {
      return {
        text: 'मुझे लोन चाहिए', // "I need a loan" in Hindi
        confidence: 0.9,
        languageCode: languageCode,
        fallback: true
      };
    }
    
    throw new Error('Failed to convert speech to text');
  }
};

// Convert text to speech
const textToSpeech = async (text, options = {}) => {
  try {
    const {
      languageCode = 'hi-IN',
      gender = 'FEMALE',
      speed = 1.0
    } = options;

    // Voice selection based on language
    const voiceMap = {
      'hi-IN': { name: 'hi-IN-Wavenet-A', ssmlGender: gender },
      'en-IN': { name: 'en-IN-Wavenet-A', ssmlGender: gender },
      'ta-IN': { name: 'ta-IN-Wavenet-A', ssmlGender: gender },
      'te-IN': { name: 'te-IN-Standard-A', ssmlGender: gender }
    };

    const voice = voiceMap[languageCode] || voiceMap['hi-IN'];

    const request = {
      input: { text: text },
      voice: voice,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed,
        pitch: 0,
        volumeGainDb: 0,
      },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;

  } catch (error) {
    console.error('Text-to-speech error:', error);
    
    // Return empty buffer for development
    if (process.env.NODE_ENV === 'development') {
      return Buffer.alloc(0);
    }
    
    throw new Error('Failed to convert text to speech');
  }
};

// Process voice command with context
const processVoiceCommand = async (audioBuffer, userContext, languageCode = 'hi-IN') => {
  try {
    // Convert speech to text
    const transcription = await speechToText(audioBuffer, languageCode);
    
    // Process the command based on context and user state
    const command = transcription.text.toLowerCase();
    
    // Basic command recognition
    const commands = {
      hindi: {
        loan_application: ['लोन', 'ऋण', 'पैसा', 'रुपया'],
        loan_status: ['स्थिति', 'status', 'कैसा है'],
        help: ['मदद', 'सहायता', 'help'],
        repeat: ['दोबारा', 'फिर से', 'repeat']
      },
      english: {
        loan_application: ['loan', 'money', 'credit', 'apply'],
        loan_status: ['status', 'check', 'how is'],
        help: ['help', 'assist', 'support'],
        repeat: ['repeat', 'again', 'once more']
      }
    };

    const lang = languageCode.startsWith('hi') ? 'hindi' : 'english';
    const langCommands = commands[lang];

    let intent = 'unknown';
    let confidence = 0.5;

    // Determine intent
    for (const [intentType, keywords] of Object.entries(langCommands)) {
      for (const keyword of keywords) {
        if (command.includes(keyword)) {
          intent = intentType;
          confidence = 0.8;
          break;
        }
      }
      if (intent !== 'unknown') break;
    }

    return {
      transcription: transcription.text,
      intent: intent,
      confidence: confidence,
      languageCode: languageCode,
      userContext: userContext
    };

  } catch (error) {
    console.error('Voice command processing error:', error);
    throw new Error('Failed to process voice command');
  }
};

// Generate voice response based on intent
const generateVoiceResponse = async (intent, userContext, languageCode = 'hi-IN') => {
  try {
    const responses = {
      hindi: {
        loan_application: `नमस्ते ${userContext.name}! मैं आपकी लोन आवेदन में मदद करूंगी। आपको कितनी राशि चाहिए?`,
        loan_status: userContext.currentLoanAmount > 0 
          ? `आपका वर्तमान लोन ${userContext.currentLoanAmount} रुपये है।`
          : 'आपका कोई सक्रिय लोन नहीं है।',
        help: 'मैं GrameenCredit की आवाज सहायक हूं। मैं लोन आवेदन, स्थिति जांच और अन्य सेवाओं में आपकी मदद कर सकती हूं।',
        unknown: 'मुझे समझ नहीं आया। कृपया फिर से कहें या मदद के लिए "सहायता" कहें।'
      },
      english: {
        loan_application: `Hello ${userContext.name}! I'll help you with your loan application. How much amount do you need?`,
        loan_status: userContext.currentLoanAmount > 0 
          ? `Your current loan amount is Rs. ${userContext.currentLoanAmount}.`
          : 'You have no active loans.',
        help: 'I am GrameenCredit voice assistant. I can help you with loan applications, status checks, and other services.',
        unknown: 'I didn\'t understand. Please say again or say "help" for assistance.'
      }
    };

    const lang = languageCode.startsWith('hi') ? 'hindi' : 'english';
    const responseText = responses[lang][intent] || responses[lang]['unknown'];

    // Convert to speech
    const audioResponse = await textToSpeech(responseText, { languageCode });

    return {
      text: responseText,
      audio: audioResponse,
      intent: intent,
      languageCode: languageCode
    };

  } catch (error) {
    console.error('Voice response generation error:', error);
    throw new Error('Failed to generate voice response');
  }
};

module.exports = {
  speechToText,
  textToSpeech,
  processVoiceCommand,
  generateVoiceResponse
};
