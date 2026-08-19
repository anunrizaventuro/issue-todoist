import { generateKeyPairSync, sign } from 'node:crypto';
import type { Env } from '../src/env.ts';

// Discord signs `timestamp + rawBody` with Ed25519. Generating our own keypair
// exercises the real verification path without any real credentials.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

export const env: Env = {
  DISCORD_PUBLIC_KEY: Buffer.from(
    publicKey.export({ format: 'jwk' }).x as string,
    'base64url',
  ).toString('hex'),
  // Empty on purpose: these tests exercise the raw-text path. Claude itself is
  // covered in claude.test.ts with an injected fetch.
  ANTHROPIC_API_KEY: '',
  TODOIST_API_TOKEN: 'unused',
  ALLOWED_GUILD_IDS: '',
};

export const noopWaitUntil = () => {};

export function request(body: string, headers: Record<string, string>): Request {
  return new Request('https://example.com/', { method: 'POST', body, headers });
}

/** Wraps a payload in headers Discord would send for it. */
export function signed(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const timestamp = '1700000000';
  return request(body, {
    'X-Signature-Ed25519': sign(null, Buffer.from(timestamp + body), privateKey).toString('hex'),
    'X-Signature-Timestamp': timestamp,
  });
}
