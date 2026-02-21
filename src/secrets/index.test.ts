import assert from "node:assert/strict"
import { describe, it } from "node:test"

import sodium_module from "libsodium-wrappers"

import { encodeSecret } from "~/secrets/index"

describe("secret encryption", () => {
  it("encrypts secret correctly", async () => {
    // Ensure libsodium is ready (initializes WASM)
    await sodium_module.ready

    const sodium = sodium_module as any
    const publicKey = "M2Kq4k1y9DiqlqLfm2YYm75x5M3SuwuNYbLyiHEMUAM="
    const privateKey = "RI2kKSjSOBmcjme5x8iv42Ozdu1rDo9QkaU2l+IFcrE="

    const encrypted = await encodeSecret(publicKey, "secret-value")

    // Decrypt to verify
    const encBytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL)
    const publicKeyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)
    const privateKeyBytes = sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL)

    // Decrypt the secret using libsodium
    const decrypted = sodium.crypto_box_seal_open(encBytes, publicKeyBytes, privateKeyBytes)

    assert.strictEqual(sodium.to_string(decrypted), "secret-value")
  })
})
