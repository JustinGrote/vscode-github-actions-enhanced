import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa"
import { u32 } from "@noble/ciphers/utils"
import { x25519 } from "@noble/curves/ed25519.js"
import { blake2b } from "@noble/hashes/blake2.js"

import { encodeSecret } from "~/secrets/index"

// Salsa20 sigma constant: "expand 32-byte k"
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])

function cryptoBoxBeforenm(sharedSecret: Uint8Array): Uint8Array {
  const zeroNonce = new Uint32Array(4)
  const key32 = u32(sharedSecret)
  const output32 = new Uint32Array(8)
  hsalsa(SIGMA, key32, zeroNonce, output32)
  return new Uint8Array(output32.buffer, output32.byteOffset, 32)
}

describe("secret encryption", () => {
  it("encrypts secret correctly", async () => {
    const publicKey = "M2Kq4k1y9DiqlqLfm2YYm75x5M3SuwuNYbLyiHEMUAM="
    const privateKey = "RI2kKSjSOBmcjme5x8iv42Ozdu1rDo9QkaU2l+IFcrE="

    const encrypted = await encodeSecret(publicKey, "secret-value")

    // Decrypt to verify (using libsodium-compatible crypto_box_seal_open)
    const sealedBox = Buffer.from(encrypted, "base64")
    const recipientPublicKey = Buffer.from(publicKey, "base64")
    const recipientPrivateKey = Buffer.from(privateKey, "base64")

    // Extract ephemeral public key and ciphertext
    const ephemeralPublicKey = sealedBox.subarray(0, 32)
    const ciphertext = sealedBox.subarray(32)

    // Compute X25519 shared secret
    const x25519SharedSecret = x25519.getSharedSecret(recipientPrivateKey, ephemeralPublicKey)

    // Derive encryption key using HSalsa20 (crypto_box_beforenm)
    const encryptionKey = cryptoBoxBeforenm(x25519SharedSecret)

    // Derive nonce (same as encryption)
    const nonceInput = new Uint8Array(64)
    nonceInput.set(ephemeralPublicKey, 0)
    nonceInput.set(recipientPublicKey, 32)
    const nonce = blake2b(nonceInput, { dkLen: 24 })

    // Decrypt using XSalsa20-Poly1305
    const cipher = xsalsa20poly1305(encryptionKey, nonce)
    const decrypted = cipher.decrypt(ciphertext)

    assert.strictEqual(new TextDecoder().decode(decrypted), "secret-value")
  })
})
