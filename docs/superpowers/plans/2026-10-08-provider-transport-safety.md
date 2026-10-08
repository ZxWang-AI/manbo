# Provider HTTP/SSE safety implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development inline in the approved main worktree. No delegation or new model/tool capabilities.

**Goal:** Make the real Pi OpenAI-compatible HTTP/SSE path single-use, receiver-bound, bounded and cancellable without exposing remote errors or credentials.

**Architecture:** A main-process transport owns a custom fetch for exactly one POST to the captured endpoint's `/chat/completions`. Node HTTPS uses an explicitly validated/pinned DNS result and normal hostname TLS verification; no redirects, environment proxy, retries or global fetch replacement. The existing Pi agent's public streamFunction passes this fetch to the same real adapter, preserving the approved history/image projection.

**Tech Stack:** Existing Node 24.21.0, Electron 44.4.5, Pi 1.1.0, node:https/dns and node:test; synthetic HTTPS server with an explicitly injected test CA and connector, never a production TLS bypass.

## Global constraints

- Four native release targets and all previously approved gates remain required. This plan is network evidence, not installer evidence.
- HTTPS only; reject credentials/query/fragment and all private/special literal or resolved addresses (including IPv6 brackets, mapped addresses, mixed public/private DNS). Pin the validated address without a second DNS lookup; keep the original hostname for TLS/SNI and Host.
- At most one fetch attempt per confirmed request; exact receiver/path/method/auth; request JSON <=8 MiB, response wire <=512 KiB, total deadline <=120 seconds from transport creation through stream completion. Reject compressed/non-SSE responses, redirect/error bodies, oversized headers, invalid/truncated streams and assistant text >20,000 UTF-16 units. No raw provider errors.
- Requests remain uncertain after transmission when cancelled or failed. No automatic retry or partial save. No Pi independent networking, tools, discovery or compaction.

### Task 1: Endpoint and error regressions

Files: modify `app/agent/model-gateway.test.mjs`, `model-gateway.mjs`; create `app/agent/provider-transport.mjs` and `provider-transport.test.mjs`.

- [x] Reproduce current literal IPv6/special IPv4 and unredacted-error failures before code changes:

```js
for (const endpoint of ['https://[::1]/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://100.64.0.1/v1', 'https://192.0.2.1/v1']) {
  let calls = 0;
  const gateway = createModelGateway({providerStore: {async readProvider() {return {config:{id:'custom',kind:'openai-compatible',endpoint},secret:'synthetic-key'};}},sessionFactory:async()=>{calls++;return {prompt:async()=> 'reply',dispose(){}};}});
  await assert.rejects(gateway.send({providerId:'custom',model:'m1',authorization,payload}), /endpoint|private|local/);
  assert.equal(calls, 0);
}
```

- [x] Share `validateProviderEndpoint(endpoint)` with gateway, normalize the actual receiver, and replace regex-based remote error filtering with `new Error('Model request failed')`; preserve fixed pre-request validation errors. Reject responses over 20,000 units. Run gateway tests.

### Task 2: Single-use pinned HTTPS transport

Files: create `provider-transport.mjs`, `provider-transport.test.mjs`; modify `model-gateway.mjs`, `pi-session.mjs`.

Interfaces:

```js
// Production defaults never accept provider/UI-controlled overrides.
createProviderTransport({endpoint,secret,signal}, {resolveHost,requestHttps,ca,timeoutMs,maxRequestBytes,maxResponseBytes} = {}) // => {fetch,dispose}
validateProviderEndpoint(endpoint) // => canonical base URL string
isPublicAddress(address) // => boolean
// Gateway's trusted constructor transportFactory defaults to createProviderTransport.
// createNoToolSession adds requestFetch; agent.streamFunction injects fetch, cacheRetention:'none', transport:'sse', maxRetries:0.
```

- [x] Write tests for mixed/rebound/private DNS, literal/mapped IPv6, exact URL/method/key, second attempt, request/response size, total deadline and abort. Missing exports are new-feature red, not proof of old vulnerability.
- [x] Implement URL/IP classification; timer + AbortController; race DNS against abort; require all resolved addresses public; HTTPS `lookup` returns only captured address, `servername` original hostname, `rejectUnauthorized:true`, `agent:false`, maxHeaderSize 16 KiB. Build only fixed auth/content/accept/user-agent headers. Node `request` does not follow redirects. Error responses never become a Response body. Buffer the complete SSE wire body within 512 KiB, verify HTTP completion/fatal UTF-8/final DONE, then pass a Response to Pi. The UI displays complete turns, so no live response streaming is introduced; the total ceiling also bounds individual parser frames. Abort/dispose destroys the socket and clears owned timers/listeners.
- [x] Use one transport per gateway request; pass its fetch to Pi via the public streamFunction and dispose in finally. Inject only at constructor/Node module boundaries for synthetic tests; renderer cannot select a resolver/CA/connector.

### Task 3: Real Pi HTTPS fixture and full regression

Files: create `app/agent/pi-http.integration.test.mjs`, synthetic TLS fixture under `app/agent/fixtures/` (test-only, excluded from packages); update README and release readiness evidence.

- [x] Run real Pi against synthetic HTTPS/SSE. Verify captured POST path, auth, prompt/history/image bytes, no tools/cwd metadata, one call, normal TLS validation. Verify redirect destination sees zero requests, 429/5xx never retry or echo synthetic sensitive body, missing finish reason/truncation/oversize rejected, slow stream deadline/abort destroy connection, TLS mismatch rejected before payload, private/mixed DNS never connects.

```js
const result = await gateway.send(approvedInput);
assert.equal(result.text, 'synthetic reply');
assert.equal(serverRequests.length, 1);
assert.equal(serverRequests[0].path, '/v1/chat/completions');
assert.equal(serverRequests[0].body.tools, undefined);
```

- [ ] Run focused then full `node --test 'app/**/*.test.mjs'`; inspect diff for secret/error/TLS bypass; record evidence precisely as Node HTTPS with real Pi, not native Electron. Ordinary commit/push and verify remote main SHA.

## Self-review

No global fetch patch, provider redirect, proxy or retry is available in production. Only synthetic certificates/keys may be fixtures. Actual cloud provider retention, native Electron DNS/runtime behavior and OS installation remain unproven by this test. Packaging stays blocked until application gates close.
