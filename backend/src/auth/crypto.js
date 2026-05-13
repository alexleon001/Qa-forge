// Hashing de passwords (bcrypt) + cifrado simétrico AES-GCM (Node crypto)
// para las API keys de IA. Llaves derivadas de SECRET_ENCRYPTION_KEY.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_ROUNDS = 12;

/** Deriva una key de 32 bytes desde el secret de env via SHA-256. */
function deriveKey() {
  const secret = process.env.SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY no configurada (o demasiado corta). ' +
        'Setear un string >=16 chars en las envs.',
    );
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Cifra un plaintext (UTF-8) con AES-256-GCM. Devuelve string base64 que contiene:
 *   iv (12 bytes) || authTag (16 bytes) || ciphertext (n bytes).
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encrypt: plaintext debe ser string no vacío');
  }
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Descifra el formato que produce encrypt(). */
export function decrypt(payloadBase64) {
  const buf = Buffer.from(payloadBase64, 'base64');
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error('decrypt: payload demasiado corto');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const enc = buf.subarray(IV_LEN + 16);
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** Devuelve los primeros 4 y últimos 4 chars (resto enmascarado). */
export function maskKey(key) {
  if (!key || key.length < 12) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

void KEY_LEN; // exportado para tests / debug si hace falta
