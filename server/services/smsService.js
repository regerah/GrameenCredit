const twilio = require('twilio');
const NodeCache = require('node-cache');

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Cache for OTPs (TTL: 10 minutes)
const otpCache = new NodeCache({ stdTTL: 600 });

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP via SMS
const sendOTP = async (phoneNumber) => {
  try {
    const otp = generateOTP();
    const formattedPhone = `+91${phoneNumber}`;
    
    // Store OTP in cache
    otpCache.set(phoneNumber, otp);
    
    // Send SMS
    const message = await client.messages.create({
      body: `Your GrameenCredit verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });
    
    console.log(`OTP sent to ${phoneNumber}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
    
  } catch (error) {
    console.error('SMS sending error:', error);
    
    // For development, store OTP anyway
    if (process.env.NODE_ENV === 'development') {
      const otp = generateOTP();
      otpCache.set(phoneNumber, otp);
      console.log(`Development OTP for ${phoneNumber}: ${otp}`);
      return { success: true, developmentOTP: otp };
    }
    
    throw new Error('Failed to send OTP');
  }
};

// Verify OTP
const verifyOTP = async (phoneNumber, providedOTP) => {
  try {
    const storedOTP = otpCache.get(phoneNumber);
    
    if (!storedOTP) {
      return false; // OTP expired or not found
    }
    
    if (storedOTP === providedOTP) {
      // Remove OTP from cache after successful verification
      otpCache.del(phoneNumber);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('OTP verification error:', error);
    return false;
  }
};

// Send loan status SMS
const sendLoanStatusSMS = async (phoneNumber, loanId, status, language = 'english') => {
  try {
    const formattedPhone = `+91${phoneNumber}`;
    
    const messages = {
      english: {
        approved: `Good news! Your loan application ${loanId} has been approved. Amount will be disbursed soon. - GrameenCredit`,
        rejected: `Your loan application ${loanId} has been rejected. Please contact support for details. - GrameenCredit`,
        disbursed: `Your loan amount for application ${loanId} has been disbursed to your account. - GrameenCredit`
      },
      hindi: {
        approved: `खुशखबरी! आपका लोन आवेदन ${loanId} स्वीकृत हो गया है। राशि जल्द ही भेजी जाएगी। - GrameenCredit`,
        rejected: `आपका लोन आवेदन ${loanId} अस्वीकार कर दिया गया है। विवरण के लिए सहायता से संपर्क करें। - GrameenCredit`,
        disbursed: `आपके लोन आवेदन ${loanId} की राशि आपके खाते में भेज दी गई है। - GrameenCredit`
      }
    };
    
    const messageText = messages[language]?.[status] || messages.english[status];
    
    if (!messageText) {
      throw new Error('Invalid status for SMS');
    }
    
    const message = await client.messages.create({
      body: messageText,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });
    
    console.log(`Loan status SMS sent to ${phoneNumber}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
    
  } catch (error) {
    console.error('Loan status SMS error:', error);
    throw new Error('Failed to send loan status SMS');
  }
};

// Send EMI reminder SMS
const sendEMIReminderSMS = async (phoneNumber, emiDetails, language = 'english') => {
  try {
    const formattedPhone = `+91${phoneNumber}`;
    const { amount, dueDate, loanId } = emiDetails;
    
    const messages = {
      english: `Reminder: Your EMI of Rs.${amount} for loan ${loanId} is due on ${dueDate}. Please pay on time to avoid charges. - GrameenCredit`,
      hindi: `अनुस्मारक: आपकी लोन ${loanId} की EMI Rs.${amount} की ${dueDate} को देय है। शुल्क से बचने के लिए समय पर भुगतान करें। - GrameenCredit`
    };
    
    const messageText = messages[language] || messages.english;
    
    const message = await client.messages.create({
      body: messageText,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });
    
    console.log(`EMI reminder SMS sent to ${phoneNumber}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
    
  } catch (error) {
    console.error('EMI reminder SMS error:', error);
    throw new Error('Failed to send EMI reminder SMS');
  }
};

// Send welcome SMS
const sendWelcomeSMS = async (phoneNumber, userName, language = 'english') => {
  try {
    const formattedPhone = `+91${phoneNumber}`;
    
    const messages = {
      english: `Welcome to GrameenCredit, ${userName}! Your account has been created successfully. Start your loan journey with us today.`,
      hindi: `GrameenCredit में आपका स्वागत है, ${userName}! आपका खाता सफलतापूर्वक बनाया गया है। आज ही हमारे साथ अपनी लोन यात्रा शुरू करें।`
    };
    
    const messageText = messages[language] || messages.english;
    
    const message = await client.messages.create({
      body: messageText,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });
    
    console.log(`Welcome SMS sent to ${phoneNumber}: ${message.sid}`);
    return { success: true, messageSid: message.sid };
    
  } catch (error) {
    console.error('Welcome SMS error:', error);
    // Don't throw error for welcome SMS as it's not critical
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  sendLoanStatusSMS,
  sendEMIReminderSMS,
  sendWelcomeSMS
};
