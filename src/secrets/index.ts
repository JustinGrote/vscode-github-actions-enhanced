import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa"
import { u32 } from "@noble/ciphers/utils"
import { x25519 } from "@noble/curves/ed25519.js"
import { blake2b } from "@noble/hashes/blake2.js"
import { randomBytes } from "@noble/hashes/utils.js"

// Salsa20 sigma constant: "expand 32-byte k"
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])

/**
 * Implements libsodium's crypto_box_beforenm using HSalsa20 key derivation.
 * Derives encryption key from X25519 shared secret.
 * @param sharedSecret - 32-byte X25519 shared secret
 * @returns 32-byte derived encryption key
 */
function cryptoBoxBeforenm(sharedSecret: Uint8Array): Uint8Array {
  const zeroNonce = new Uint32Array(4) // 16 bytes of zeros
  const key32 = u32(sharedSecret) // Convert 32-byte key to Uint32Array
  const output32 = new Uint32Array(8) // Output: 32 bytes

  // HSalsa20(zero_nonce, shared_secret, sigma) -> derived_key
  hsalsa(SIGMA, key32, zeroNonce, output32)

  return new Uint8Array(output32.buffer, output32.byteOffset, 32)
}

/**
 * Encrypts a secret using X25519-XSalsa20-Poly1305 sealed box construction.
 * Compatible with libsodium's crypto_box_seal.
 * @param key - Base64-encoded recipient public key (32 bytes)
 * @param value - Secret value to encrypt
 * @returns Base64-encoded sealed box (ephemeral_pk || ciphertext)
 */
export async function encodeSecret(key: string, value: string): Promise<string> {
  // Decode the base64 recipient public key
  const recipientPublicKey = Buffer.from(key, "base64")

  if (recipientPublicKey.length !== 32) {
    throw new Error("Invalid public key length")
  }

  // Generate ephemeral keypair
  const ephemeralSecretKey = randomBytes(32)
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey)

  // Compute X25519 shared secret
  const x25519SharedSecret = x25519.getSharedSecret(ephemeralSecretKey, recipientPublicKey)

  // Derive encryption key using HSalsa20 (crypto_box_beforenm)
  const encryptionKey = cryptoBoxBeforenm(x25519SharedSecret)

  // Derive nonce from Blake2b(ephemeral_pk || recipient_pk)
  // This matches libsodium's crypto_box_seal nonce derivation
  const nonceInput = new Uint8Array(64)
  nonceInput.set(ephemeralPublicKey, 0)
  nonceInput.set(recipientPublicKey, 32)
  const nonce = blake2b(nonceInput, { dkLen: 24 })

  // Encrypt the message using XSalsa20-Poly1305
  const messageBytes = new TextEncoder().encode(value)
  const cipher = xsalsa20poly1305(encryptionKey, nonce)
  const ciphertext = cipher.encrypt(messageBytes)

  // Sealed box format: ephemeral_pk || ciphertext
  const sealedBox = new Uint8Array(32 + ciphertext.length)
  sealedBox.set(ephemeralPublicKey, 0)
  sealedBox.set(ciphertext, 32)

  // Convert to base64
  return Buffer.from(sealedBox).toString("base64")
}
