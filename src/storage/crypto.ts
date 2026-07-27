import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedData {
  salt: string;   // hex
  iv: string;     // hex
  tag: string;    // hex
  data: string;   // hex
}

/**
 * 使用 PBKDF2 从密码派生密钥
 */
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, 'sha512', (err: Error | null, key: Buffer) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * 加密数据
 */
export async function encrypt(plaintext: string, password: string): Promise<EncryptedData> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

/**
 * 解密数据
 * @throws 错误密码时抛出异常
 */
export async function decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const tag = Buffer.from(encryptedData.tag, 'hex');
  const data = Buffer.from(encryptedData.data, 'hex');
  const key = await deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    throw new Error('DECRYPT_FAILED');
  }
}
