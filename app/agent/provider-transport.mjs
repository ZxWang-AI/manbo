import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { checkServerIdentity, rootCertificates } from 'node:tls';

const failed = () => new Error('Model request failed');
const MAX_REQUEST = 8 * 1024 * 1024;
const MAX_RESPONSE = 512 * 1024;
const MAX_TIMEOUT = 120_000;

export function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (version !== 6 || address.includes('%')) return false;
  // Conservative global-unicast allowlist. Mapped/compatible IPv4, NAT64,
  // local/multicast, IETF assignments, documentation and 6to4 are not receivers.
  const [first, second = '0'] = address.toLowerCase().split(':');
  const a = Number.parseInt(first, 16), b = Number.parseInt(second || '0', 16);
  return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && a !== 0x3fff
    && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8));
}

export function validateProviderEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Provider endpoint is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Provider endpoint must be HTTPS without credentials, query or fragment');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || (isIP(host) && !isPublicAddress(host)) || (!isIP(host) && !host.includes('.'))) throw new Error('Private or local provider endpoints are not allowed');
  return url.toString().replace(/\/+$/, '');
}

function limit(value, maximum) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw failed();
  return value;
}

// Dependencies are trusted main-process constructor arguments, never provider
// config or IPC fields. Production always uses system DNS and validating HTTPS.
export function createProviderTransport({ endpoint, secret, signal } = {}, {
  resolveHost = (hostname) => lookup(hostname, { all: true, verbatim: true }),
  requestHttps = request, ca = rootCertificates, timeoutMs, maxRequestBytes, maxResponseBytes,
} = {}) {
  const base = validateProviderEndpoint(endpoint);
  const receiver = new URL(base + '/chat/completions');
  const hostname = receiver.hostname.replace(/^\[|\]$/g, '');
  if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret)) throw failed();
  const timeout = limit(timeoutMs, MAX_TIMEOUT);
  const requestLimit = limit(maxRequestBytes, MAX_REQUEST);
  const responseLimit = limit(maxResponseBytes, MAX_RESPONSE);
  const controller = new AbortController();
  let attempted = false, disposed = false, ownedRequest;
  const externalAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', externalAbort, { once: true });
  const timer = setTimeout(externalAbort, timeout);
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', externalAbort);
    controller.abort();
    ownedRequest?.destroy();
  };

  const fetch = async (input, init = {}) => {
    if (attempted || disposed || controller.signal.aborted) throw failed();
    attempted = true;
    const sdkSignal = init.signal;
    sdkSignal?.addEventListener('abort', externalAbort, { once: true });
    if (sdkSignal?.aborted) controller.abort();
    let removeAbort;
    try {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      if (url.href !== receiver.href || init.method !== 'POST' || typeof init.body !== 'string'
        || Buffer.byteLength(init.body, 'utf8') > requestLimit
        || headers.get('authorization') !== `Bearer ${secret}`) throw failed();
      controller.signal.throwIfAborted();
      const aborted = new Promise((_, reject) => {
        const abort = () => { ownedRequest?.destroy(); reject(failed()); };
        controller.signal.addEventListener('abort', abort, { once: true });
        removeAbort = () => controller.signal.removeEventListener('abort', abort);
      });
      const addresses = await Promise.race([
        isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : resolveHost(hostname),
        aborted,
      ]);
      controller.signal.throwIfAborted();
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > 16
        || addresses.some(({ address, family } = {}) => !isPublicAddress(address) || isIP(address) !== family)) throw failed();
      const pinned = Object.freeze({ ...addresses[0] });
      const body = await Promise.race([new Promise((resolve, reject) => {
        let done = false;
        const fail = () => { if (!done) { done = true; ownedRequest?.destroy(); reject(failed()); } };
        ownedRequest = requestHttps({
          protocol: 'https:', hostname, port: receiver.port || 443,
          path: receiver.pathname, method: 'POST', agent: false,
          servername: isIP(hostname) ? undefined : hostname,
          ca, rejectUnauthorized: true, checkServerIdentity,
          maxHeaderSize: 16 * 1024, minVersion: 'TLSv1.2',
          lookup(_host, options, callback) {
            if (options?.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
          headers: {
            host: receiver.host, authorization: `Bearer ${secret}`,
            'content-type': 'application/json', accept: 'text/event-stream',
            'accept-encoding': 'identity', 'user-agent': 'Manbo/0.1 Alpha',
            'content-length': Buffer.byteLength(init.body, 'utf8'),
          },
        }, (response) => {
          // Node HTTPS never follows redirects. Never expose arbitrary remote
          // headers/error bodies to Pi's SDK error formatter.
          const length = response.headers['content-length'];
          if (response.statusCode !== 200 || !/^text\/event-stream(?:;|$)/i.test(response.headers['content-type'] ?? '')
            || ![undefined, 'identity'].includes(response.headers['content-encoding'])
            || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > responseLimit))) {
            response.on('error', () => {});
            response.destroy(); fail(); return;
          }
          const chunks = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > responseLimit) { response.destroy(); fail(); }
            else chunks.push(chunk);
          });
          response.on('error', fail);
          response.on('aborted', fail);
          response.on('end', () => {
            if (done) return;
            if (!response.complete) { fail(); return; }
            done = true;
            resolve(Buffer.concat(chunks));
          });
        });
        ownedRequest.on('error', fail);
        ownedRequest.end(init.body);
      }), aborted]);
      controller.signal.throwIfAborted();
      // The UI currently displays only complete turns. Buffer a strictly bounded
      // wire response so an early [DONE] cannot hide truncation or an endless tail.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      if (!/(?:^|\n)data:\s*\[DONE\]\r?\n\r?\n$/.test(text)) throw failed();
      clearTimeout(timer);
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    } catch { throw failed(); }
    finally {
      removeAbort?.();
      sdkSignal?.removeEventListener('abort', externalAbort);
      clearTimeout(timer);
      ownedRequest?.destroy();
    }
  };
  return Object.freeze({ fetch, dispose });
}
