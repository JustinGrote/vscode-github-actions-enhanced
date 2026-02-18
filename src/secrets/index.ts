const sodium = require('libsodium-wrappers');

export async function encodeSecret(key: string, value: string): Promise<string> {
  // Check if libsodium is ready and then proceed.
  await sodium.ready;

  // Convert the secret and key to a Uint8Array.
  const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binsec = sodium.from_string(value);

  // Encrypt the secret using libsodium
  const encBytes = sodium.crypto_box_seal(binsec, binkey);

  // Convert the encrypted Uint8Array to Base64
  const output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

  return output;
}
