import { webcrypto } from 'node:crypto';

export async function encodeSecret(key: string, value: string): Promise<string> {
  const publicKeyBytes = Buffer.from(key, 'base64');
  const secretBytes = Buffer.from(value, 'utf-8');

  // Import recipient's public key
  const publicKey = await webcrypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    { name: 'X25519' },
    false,
    ['deriveBits']
  );

  // Generate ephemeral keypair
  const ephemeralKeyPair = await webcrypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;

  // Perform ECDH to get shared secret
  const sharedSecret = await webcrypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    ephemeralKeyPair.privateKey,
    256
  );

  // Derive encryption key from shared secret
  const encryptionKey = await webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(0) },
    await webcrypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate IV
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  // Encrypt the secret
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    secretBytes
  );

  // Export ephemeral public key
  const ephemeralPublicKey = await webcrypto.subtle.exportKey(
    'raw',
    ephemeralKeyPair.publicKey
  );

  // Combine: ephemeral_pk || iv || ciphertext
  const combined = Buffer.concat([
    Buffer.from(ephemeralPublicKey),
    Buffer.from(iv),
    Buffer.from(ciphertext)
  ]);

  return combined.toString('base64');
}
