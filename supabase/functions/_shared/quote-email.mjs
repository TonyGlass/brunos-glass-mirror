// Server-only preparation boundary. Not imported by customer JavaScript or invoked
// by submit-quote. A later provider adapter must keep credentials in server secrets.
export const unavailableEmailProvider = Object.freeze({
  id:'unconfigured',
  async send() { return {status:'not-configured', sent:false}; }
});
export function prepareQuoteConfirmation({to, orderNumber, accessCode, trackingUrl, finalQuoteDocument = null, finalQuoteUrl = null} = {}) {
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw Error('A customer email address is required.');
  if (typeof orderNumber !== 'string' || !/^BGM-\d{4}-[0-9A-F]{5,}$/.test(orderNumber) || typeof accessCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(accessCode)) throw Error('Backend-issued tracking credentials are required.');
  const url = new URL(trackingUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search) throw Error('Use a trusted HTTPS tracking page without embedded credentials.');
  let finalLink = null;
  if (finalQuoteUrl) {
    if (finalQuoteDocument?.kind !== 'admin-final-quote' || finalQuoteDocument.authoritative !== true || !finalQuoteDocument.dates?.publishedAt) throw Error('Only a published Admin Final Quote may be linked.');
    const parsed = new URL(finalQuoteUrl);
    if (parsed.protocol !== 'https:' || parsed.origin !== url.origin || parsed.username || parsed.password || parsed.search) throw Error('Use an authenticated same-origin Final Quote page, without credentials in the URL.');
    finalLink = parsed.href;
  }
  const lines = ["Bruno's Glass & Mirror has received your quotation request.", `Project Order: ${orderNumber}`,
    `Private access code: ${accessCode}`, `Track your project: ${url.href}`,
    'Enter both your order number and private access code. Keep the code private.',
    finalLink ? `Your published Admin Final Quote: ${finalLink}` : 'Bruno will review your request before publishing a Final Quote.',
    'No payment has been charged by this confirmation.'];
  return {kind:'quote-request-confirmation', to, subject:`Bruno's Glass & Mirror — ${orderNumber}`, text:lines.join('\n\n'),
    attachments:[], finalQuoteUrl:finalLink, delivery:{status:'prepared', sent:false}};
}
export async function deliverQuoteConfirmation(message, {provider = unavailableEmailProvider, idempotencyKey} = {}) {
  if (message?.kind !== 'quote-request-confirmation') throw Error('A prepared confirmation is required.');
  if (provider === unavailableEmailProvider) return provider.send();
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw Error('A server-side idempotency key is required.');
  const receipt = await provider.send(message, {idempotencyKey});
  // Provider acceptance is not proof of delivery; delivery requires a verified webhook.
  if (receipt?.status !== 'accepted' || typeof receipt.messageId !== 'string' || !receipt.messageId) throw Error('Email provider did not confirm acceptance.');
  return {status:'accepted', messageId:receipt.messageId, delivered:false};
}
