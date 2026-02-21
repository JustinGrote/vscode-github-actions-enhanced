import libsodium from "libsodium-wrappers"

export async function encodeSecret(key: string, value: string): Promise<string> {
  // Ensure libsodium is ready (initializes WASM)
  await libsodium.ready

  // Access the crypto functions from the now-initialized libsodium module
  const sodium = libsodium as any

  // Convert the secret and key to a Uint8Array.
  const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
  const binsec = sodium.from_string(value)

  // Encrypt the secret using libsodium's sealed box encryption
  const encBytes = sodium.crypto_box_seal(binsec, binkey)

  // Convert the encrypted Uint8Array to Base64
  const output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)

  return output
}
