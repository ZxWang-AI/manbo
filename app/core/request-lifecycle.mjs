import { createHash, randomUUID } from 'node:crypto';

function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function snapshot(value, maxBytes = 8 * 1024 * 1024) {
  let nodes=0; let bytes=0; const ancestors=new Set();
  function check(item,depth) {
    if(++nodes > 20000 || depth > 16) throw new Error('Snapshot limit');
    if(typeof item === 'string') bytes+=Buffer.byteLength(item);
    else if(item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) bytes+=8;
    else if(item && typeof item === 'object' && !ancestors.has(item) && typeof item.toJSON !== 'function'
      && (Array.isArray(item) || Object.prototype.toString.call(item) === '[object Object]')) {
      ancestors.add(item);
      for(const [key,child] of Object.entries(item)) {bytes+=Buffer.byteLength(key); check(child,depth+1);}
      ancestors.delete(item);
    } else throw new Error('Invalid snapshot');
    if(bytes > maxBytes) throw new Error('Snapshot limit');
  }
  check(value,0);
  const encoded=JSON.stringify(value);
  if(Buffer.byteLength(encoded) > maxBytes) throw new Error('Snapshot limit');
  return freeze(JSON.parse(encoded));
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function binding(prepared) {
  return createHash('sha256').update(stable({provider:prepared.provider,payload:prepared.payload,revision:prepared.revision})).digest('hex');
}

export function createRequestLifecycle({prepare, send, persist, clock = Date.now, timeoutMs = 120000} = {}) {
  if (![prepare,send,persist].every((fn) => typeof fn === 'function') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid request lifecycle');
  const receipts = new Map(); const requests = new Map(); const busy = new Set(); let closed = false; let preparing = 0;
  function prune() {
    for (const [id,receipt] of receipts) if (receipt.expires <= clock()) receipts.delete(id);
    while (receipts.size >= 32) receipts.delete(receipts.keys().next().value);
  }
  async function preview(input) {
    if (closed) throw new Error('Lifecycle closed');
    if (!input || typeof input.conversationId !== 'string' || !input.conversationId || busy.has(input.conversationId) || preparing >= 8) throw new Error('Conversation busy or invalid');
    const captured = snapshot(input,256 * 1024); preparing++;
    let prepared;
    try { prepared = snapshot(await prepare(captured)); } finally { preparing--; }
    if (closed) throw new Error('Lifecycle closed');
    const receiptId = randomUUID(); prune();
    const publicPreview = snapshot({...prepared.preview,receiver:{name:prepared.provider.config.name,endpoint:prepared.provider.config.endpoint},receiptId});
    receipts.set(receiptId,{input:captured,prepared,binding:binding(prepared),preview:publicPreview,expires:clock()+300000});
    return publicPreview;
  }
  function start({receiptId,confirmation} = {}) {
    const receipt = receipts.get(receiptId); receipts.delete(receiptId);
    if (closed || !receipt || receipt.expires <= clock()) throw new Error('Invalid or expired receipt');
    if (confirmation?.accepted !== true || stable(snapshot(confirmation.preview,2 * 1024 * 1024)) !== stable(receipt.preview)) throw new Error('Confirmation changed');
    const conversationId = receipt.input.conversationId;
    if (busy.has(conversationId) || busy.size >= 8) throw new Error('Conversation busy');
    busy.add(conversationId);
    const requestId = receiptId; const controller = new AbortController();
    let complete; const promise = new Promise((resolve) => {complete=resolve;});
    const state = {controller,promise,stage:'preparing',done:false,requestId};
    requests.set(requestId,state);
    function finish(delivery,messages) {
      if (state.done) return;
      state.done = true; clearTimeout(state.timer); busy.delete(conversationId);
      complete(freeze({requestId,delivery,...(messages ? {messages} : {})}));
      // Never evict an active request; retained completed outcomes are bounded.
      const completed = [...requests].filter(([,value]) => value.done);
      for (const [id] of completed.slice(0,Math.max(0,completed.length-64))) requests.delete(id);
    }
    controller.signal.addEventListener('abort',() => {
      if (state.stage !== 'persisting') finish(state.stage === 'preparing' ? 'cancelled' : 'unknown');
    },{once:true});
    state.timer = setTimeout(() => controller.abort(),timeoutMs);
    // Start ID is returned before revalidation, allowing cancellation in the first UI turn.
    void Promise.resolve().then(async () => {
      if (state.done) return;
      try {
        const current = snapshot(await prepare(receipt.input));
        if (state.done) return;
        if (binding(current) !== receipt.binding) {finish('failed'); return;}
        state.stage = 'sending';
        const response = await send(receipt.prepared,{signal:controller.signal,requestId});
        if (state.done || controller.signal.aborted) return;
        state.stage = 'persisting'; clearTimeout(state.timer);
        const messages = await persist(receipt.prepared,response,{requestId});
        finish('delivered',messages);
      } catch { finish(state.stage === 'preparing' ? 'failed' : 'unknown'); }
    });
    return freeze({requestId});
  }
  function abort(requestId) {
    const state = requests.get(requestId);
    const canAbort = Boolean(state && !state.done && state.stage !== 'persisting');
    if (canAbort) state.controller.abort();
    return freeze({aborted:canAbort});
  }
  return Object.freeze({preview,start,abort,
    result(requestId) {const state=requests.get(requestId); if(!state) return Promise.reject(new Error('Unknown request')); return state.promise;},
    discard(receiptId) {return {discarded:receipts.delete(receiptId)};},
    dispose() {closed=true; receipts.clear(); for(const id of requests.keys()) abort(id);},
  });
}
