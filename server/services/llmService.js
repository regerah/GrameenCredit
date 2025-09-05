const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Get loan assistant response using LLM
const getLoanAssistantResponse = async (userInput, userContext, context = 'general') => {
  try {
    const systemPrompt = `You are a helpful loan assistant for GrameenCredit, an AI-enabled lending app for rural India. 

User Context:
- Name: ${userContext.name}
- Language: ${userContext.preferredLanguage}
- Aadhaar Verified: ${userContext.aadhaarVerified}
- PAN Verified: ${userContext.panVerified}
- Credit Score: ${userContext.creditScore || 'Not available'}
- Current Loan: Rs. ${userContext.currentLoanAmount}
- Occupation: ${userContext.occupation}
- Monthly Income: Rs. ${userContext.monthlyIncome}
- Loan Eligible: ${userContext.isEligibleForLoan}

Guidelines:
1. Respond in ${userContext.preferredLanguage === 'hindi' ? 'Hindi (Devanagari script)' : 'English'}
2. Use simple, clear language suitable for low digital literacy users
3. Be empathetic and supportive
4. Provide step-by-step guidance
5. Always prioritize user's financial wellbeing
6. If user needs verification, guide them through the process
7. For loan amounts, stay within Rs. 5,000 to Rs. 1,00,000 range
8. Explain terms clearly and get confirmation

Context: ${context}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const assistantMessage = response.choices[0].message.content;

    // Extract any action items or next steps
    const actions = extractActions(assistantMessage, userContext);

    return {
      text: assistantMessage,
      actions: actions,
      context: context,
      language: userContext.preferredLanguage
    };

  } catch (error) {
    console.error('LLM service error:', error);
    
    // Fallback responses
    const fallbackResponses = {
      hindi: 'मुझे खुशी होगी आपकी मदद करने में। कृपया अपना सवाल फिर से पूछें।',
      english: 'I would be happy to help you. Please ask your question again.'
    };
    
    return {
      text: fallbackResponses[userContext.preferredLanguage] || fallbackResponses.english,
      actions: [],
      context: context,
      language: userContext.preferredLanguage,
      fallback: true
    };
  }
};

// Extract actionable items from LLM response
const extractActions = (message, userContext) => {
  const actions = [];
  const lowerMessage = message.toLowerCase();

  // Check for common action patterns
  if (lowerMessage.includes('verify') || lowerMessage.includes('सत्यापन')) {
    if (!userContext.aadhaarVerified) {
      actions.push({ type: 'verify_aadhaar', priority: 'high' });
    }
    if (!userContext.panVerified) {
      actions.push({ type: 'verify_pan', priority: 'high' });
    }
  }

  if (lowerMessage.includes('apply') || lowerMessage.includes('आवेदन')) {
    actions.push({ type: 'start_application', priority: 'medium' });
  }

  if (lowerMessage.includes('amount') || lowerMessage.includes('राशि')) {
    actions.push({ type: 'specify_amount', priority: 'medium' });
  }

  if (lowerMessage.includes('documents') || lowerMessage.includes('दस्तावेज')) {
    actions.push({ type: 'upload_documents', priority: 'medium' });
  }

  return actions;
};

// Analyze SMS data using LLM
const analyzeSMSData = async (smsData) => {
  try {
    const systemPrompt = `You are an expert financial analyst specializing in alternative credit scoring for rural India. Analyze the provided SMS transaction data and extract meaningful financial behavior patterns.

Focus on:
1. Transaction regularity and patterns
2. Income stability indicators
3. Spending behavior
4. Banking relationship strength
5. Digital payment adoption
6. Risk indicators

Provide a structured analysis with scores (0-100) for each category.`;

    const smsText = smsData.map(sms => 
      `Date: ${sms.date}, Amount: ${sms.amount}, Type: ${sms.type}, Message: ${sms.message}`
    ).join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this SMS data:\n${smsText}` }
      ],
      max_tokens: 800,
      temperature: 0.3,
    });

    return parseAnalysisResponse(response.choices[0].message.content);

  } catch (error) {
    console.error('SMS analysis error:', error);
    return getDefaultAnalysis();
  }
};

// Parse LLM analysis response into structured data
const parseAnalysisResponse = (analysisText) => {
  // Extract scores using regex patterns
  const scorePattern = /(\w+):\s*(\d+)/g;
  const scores = {};
  let match;

  while ((match = scorePattern.exec(analysisText)) !== null) {
    scores[match[1].toLowerCase()] = parseInt(match[2]);
  }

  return {
    transactionRegularity: scores.regularity || 50,
    incomeStability: scores.income || 50,
    spendingBehavior: scores.spending || 50,
    bankingRelationship: scores.banking || 50,
    digitalAdoption: scores.digital || 50,
    riskIndicators: scores.risk || 50,
    overallScore: Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length || 50,
    analysis: analysisText,
    confidence: 0.7
  };
};

// Get default analysis for fallback
const getDefaultAnalysis = () => {
  return {
    transactionRegularity: 60,
    incomeStability: 55,
    spendingBehavior: 65,
    bankingRelationship: 50,
    digitalAdoption: 45,
    riskIndicators: 70,
    overallScore: 57.5,
    analysis: 'Default analysis due to processing error',
    confidence: 0.3
  };
};

// Generate loan recommendation using LLM
const generateLoanRecommendation = async (creditAnalysis, userProfile) => {
  try {
    const systemPrompt = `You are a loan underwriting expert for rural India. Based on the credit analysis and user profile, provide a loan recommendation.

Consider:
1. Alternative credit score and confidence level
2. Risk category and factors
3. User's income and occupation
4. Loan amount requested vs. recommended
5. Interest rate and tenure suggestions
6. Conditions or requirements

Provide a clear recommendation with reasoning.`;

    const analysisData = `
Credit Score: ${creditAnalysis.alternativeCreditScore}
Risk Category: ${creditAnalysis.riskCategory}
Confidence: ${creditAnalysis.confidenceLevel}
User Income: Rs. ${userProfile.monthlyIncome}
Occupation: ${userProfile.occupation}
Requested Amount: Rs. ${userProfile.requestedAmount || 'Not specified'}
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: analysisData }
      ],
      max_tokens: 600,
      temperature: 0.3,
    });

    return {
      recommendation: response.choices[0].message.content,
      timestamp: new Date(),
      model: 'gpt-3.5-turbo'
    };

  } catch (error) {
    console.error('Loan recommendation error:', error);
    return {
      recommendation: 'Unable to generate recommendation at this time. Please try again later.',
      timestamp: new Date(),
      error: true
    };
  }
};

module.exports = {
  getLoanAssistantResponse,
  analyzeSMSData,
  generateLoanRecommendation
};
