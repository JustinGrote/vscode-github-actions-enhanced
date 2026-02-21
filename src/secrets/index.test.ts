import {encodeSecret} from "./index"
const sodium = require("libsodium-wrappers")

describe("secret encryption", () => {
  it("encrypts secret correctly", async () => {
    // Check if libsodium is ready
    await sodium.ready

    const publicKey = "M2Kq4k1y9DiqlqLfm2YYm75x5M3SuwuNYbLyiHEMUAM="
    const privateKey = "RI2kKSjSOBmcjme5x8iv42Ozdu1rDo9QkaU2l+IFcrE="

    const encrypted = await encodeSecret(publicKey, "secret-value")

    // Decrypt to verify
    const encBytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL)
    const publicKeyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)
    const privateKeyBytes = sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL)

    // Decrypt the secret using libsodium
    const decrypted = sodium.crypto_box_seal_open(encBytes, publicKeyBytes, privateKeyBytes)

    expect(sodium.to_string(decrypted)).toBe("secret-value")
  })
})
