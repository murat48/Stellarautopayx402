/**
 * Payment link service.
 * Generates HMAC-secured, public-facing payment URLs.
 * URL format: {baseUrl}/pay/{billId}/{token}
 */
import { createHmac, timingSafeEqual } from 'crypto';
import config from '../config.js';

export function generateToken(billId) {
  return createHmac('sha256', config.paymentLinkSecret)
    .update(String(billId))
    .digest('hex')
    .slice(0, 32);
}

export function buildPaymentUrl(billId) {
  const token = generateToken(billId);
  return `${config.paymentLinkBaseUrl}/pay/${billId}/${token}`;
}

export function verifyToken(billId, token) {
  const expected = Buffer.from(generateToken(billId));
  const actual   = Buffer.from(String(token ?? ''));
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
