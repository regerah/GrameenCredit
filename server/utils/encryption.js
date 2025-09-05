const crypto = require('crypto');

const algorithm = process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm';
const secretKey = process.env.ENCRYPTION_KEY || 'your-32-character-secret-key-here';

// Ensure the key is the right length
const key = crypto.scryptSync(secretKey, 'salt', 32);

// Encrypt data
const encryptData = (text) => {
  try {
    if (!text) return null;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

// Decrypt data
const decryptData = (encryptedData) => {
  try {
    if (!encryptedData) return null;
    
    const { encrypted, iv, authTag } = encryptedData;
    const decipher = crypto.createDecipher(algorithm, key);
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

// Hash sensitive data (one-way)
const hashData = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

// Generate secure random token
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

module.exports = {
  encryptData,
  decryptData,
  hashData,
  generateSecureToken
};
