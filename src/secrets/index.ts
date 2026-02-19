import { ready, from_base64, base64_variants, from_string, crypto_box_seal, to_base64} from 'libsodium-wrappers';

export async function encodeSecret(key: string, value: string): Promise<string> {
  // Check if libsodium is ready and then proceed.
  await ready;

  // Convert the secret and key to a Uint8Array.
  const binkey = from_base64(key, base64_variants.ORIGINAL);
  const binsec = from_string(value);

  // Encrypt the secret using libsodium
  const encBytes = crypto_box_seal(binsec, binkey);

  // Convert the encrypted Uint8Array to Base64
  const output = to_base64(encBytes, base64_variants.ORIGINAL);

  return output;
}
