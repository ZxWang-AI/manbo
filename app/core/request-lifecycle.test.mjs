import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLifecycle } from './request-lifecycle.mjs';

function fixture(t, options = {}) {
  let calls = 0; let saves = 0; let time = 0;
  const state = { provider: { config: { id:'custom', name:'Synthetic', endpoint:'https://example.test/v1', model:'m' }, secret:'SYNTHETIC-NOT-REAL' },
    revision:'r1', payload:{ requestHash:'hash1', prompt:'hello', scope:{evidenceIds:[]} },
    preview:{provider:'custom',model:'m',prompt:'hello',attachments:[],scope:{evidenceIds:[]},contextMessages:[],requestHash:'hash1'} };
  const lifecycle = createRequestLifecycle({ clock:() => time, prepare:async () => state,
    send:async (...args) => { calls++; return options.send ? options.send(...args) : {text:'reply'}; },
    persist:async (...args) => { saves++; return options.persist ? options.persist(...args) : ['stored']; }, ...options });
  t.after(() => lifecycle.dispose());
  return { lifecycle, state, calls:() => calls, saves:() => saves, advance:() => { time += 300001; } };
}
const input = {conversationId:'conversation-1',draft:{prompt:'hello'}};
function start(lifecycle, preview) { return lifecycle.start({receiptId:preview.receiptId,confirmation:{accepted:true,preview}}); }

test('receipt is required, accepted once and bound to actual confirmation fields', async (t) => {
  const f = fixture(t); const preview = await f.lifecycle.preview(input);
  assert.throws(() => start(f.lifecycle, {...preview, prompt:'changed'}), /confirmation/i);
  // A rejected forged confirmation consumes the receipt too.
  assert.throws(() => start(f.lifecycle, preview), /receipt/i);
  assert.equal(f.calls(), 0);
  const valid = await f.lifecycle.preview(input); const begun = start(f.lifecycle, valid);
  assert.throws(() => start(f.lifecycle, valid), /receipt/i);
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery, 'delivered');
  assert.equal(f.calls(), 1); assert.equal(f.saves(), 1);
  assert.equal(JSON.stringify(valid).includes('SYNTHETIC-NOT-REAL'), false);
});

test('ID is available before work and immediate cancel prevents model call', async (t) => {
  const f = fixture(t); const preview = await f.lifecycle.preview(input);
  const begun = start(f.lifecycle, preview);
  assert.equal(typeof begun.requestId, 'string');
  assert.equal(f.lifecycle.abort(begun.requestId).aborted, true);
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery, 'cancelled');
  assert.equal(f.calls(), 0); assert.equal(f.saves(), 0);
});

test('same conversation cannot start concurrent requests', async (t) => {
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture(t, {send:async () => {await wait; return {text:'reply'};}});
  const a = await f.lifecycle.preview(input); const b = await f.lifecycle.preview(input);
  const begun = start(f.lifecycle, a);
  assert.throws(() => start(f.lifecycle,b), /busy/i);
  release(); await f.lifecycle.result(begun.requestId);
});

test('expired and discarded previews cannot start', async (t) => {
  const f = fixture(t); const a = await f.lifecycle.preview(input); f.advance();
  assert.throws(() => start(f.lifecycle,a), /receipt/i);
  const b = await f.lifecycle.preview(input); f.lifecycle.discard(b.receiptId);
  assert.throws(() => start(f.lifecycle,b), /receipt/i); assert.equal(f.calls(),0);
});

for (const mutation of ['key','endpoint','payload','revision']) test(`${mutation} drift invalidates confirmation before send`, async (t) => {
  const f = fixture(t); const preview = await f.lifecycle.preview(input);
  if (mutation === 'key') f.state.provider.secret = 'ANOTHER-SYNTHETIC';
  if (mutation === 'endpoint') f.state.provider.config.endpoint = 'https://other.test/v1';
  if (mutation === 'payload') f.state.payload.requestHash = 'hash2';
  if (mutation === 'revision') f.state.revision = 'r2';
  const begun = start(f.lifecycle,preview);
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery, 'failed'); assert.equal(f.calls(),0);
});

test('cancel after model start is unknown and no partial output is persisted', async (t) => {
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  const f = fixture(t,{send:async (_prepared,{signal}) => { entered(); await new Promise((resolve) => signal.addEventListener('abort',resolve,{once:true})); return {text:'partial'}; }});
  const begun = start(f.lifecycle,await f.lifecycle.preview(input)); await started;
  f.lifecycle.abort(begun.requestId);
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery,'unknown'); assert.equal(f.saves(),0);
});

test('save failure never reports delivered or leaks echoed credentials', async (t) => {
  const f = fixture(t,{persist:async () => {throw new Error('SYNTHETIC-NOT-REAL prompt echoed');}});
  const begun = start(f.lifecycle,await f.lifecycle.preview(input)); const result = await f.lifecycle.result(begun.requestId);
  assert.equal(result.delivery,'unknown'); assert.equal(JSON.stringify(result).includes('SYNTHETIC'),false);
});

test('deadline aborts a stalled request without waiting for ignored signal', async (t) => {
  const f = fixture(t,{timeoutMs:15,send:async () => new Promise(() => {})});
  const begun = start(f.lifecycle,await f.lifecycle.preview(input));
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery,'unknown');
});

test('dispose aborts outstanding work and refuses new previews', async (t) => {
  const f = fixture(t); const begun = start(f.lifecycle,await f.lifecycle.preview(input)); f.lifecycle.dispose();
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery,'cancelled');
  await assert.rejects(f.lifecycle.preview(input),/closed/i);
});

test('receipt storage is bounded and evicts old previews', async (t) => {
  const f = fixture(t); const first = await f.lifecycle.preview(input);
  for(let i=0;i<32;i++) await f.lifecycle.preview(input);
  assert.throws(() => start(f.lifecycle,first), /receipt/i);
});

test('oversized or deeply nested draft rejects before preparation', async (t) => {
  let prepares=0; const f=fixture(t,{prepare:async () => {prepares++; return f.state;}});
  await assert.rejects(f.lifecycle.preview({...input,draft:{prompt:'x'.repeat(262145)}}),/invalid|limit/i);
  let nested={}; for(let i=0;i<30;i++) nested={child:nested};
  await assert.rejects(f.lifecycle.preview({...input,draft:nested}),/invalid|limit/i);
  assert.equal(prepares,0);
});

test('eight active conversations limit further starts and cancellation frees capacity', async (t) => {
  const f=fixture(t,{send:async () => new Promise(() => {})});
  const previews=[]; for(let i=0;i<9;i++) previews.push(await f.lifecycle.preview({...input,conversationId:`c${i}`}));
  const active=previews.slice(0,8).map((p) => start(f.lifecycle,p));
  assert.throws(() => start(f.lifecycle,previews[8]),/busy/i);
  f.lifecycle.abort(active[0].requestId);
  const next=start(f.lifecycle,await f.lifecycle.preview({...input,conversationId:'c9'}));
  f.lifecycle.abort(next.requestId);
  assert.equal((await f.lifecycle.result(next.requestId)).delivery,'cancelled');
});

test('completed outcomes are capped at 64 without evicting the newest outcome', async (t) => {
  const f=fixture(t); let first; let last;
  for(let i=0;i<65;i++) {last=start(f.lifecycle,await f.lifecycle.preview(input)); first??=last; await f.lifecycle.result(last.requestId);}
  await assert.rejects(f.lifecycle.result(first.requestId),/unknown/i);
  assert.equal((await f.lifecycle.result(last.requestId)).delivery,'delivered');
});

test('send receives the frozen confirmed provider rather than live mutable settings', async (t) => {
  let captured;
  const f=fixture(t,{send:async (prepared) => {
    captured=prepared; f.state.provider.secret='MUTATED-AFTER-START';
    assert.throws(() => {prepared.provider.config.endpoint='https://changed.test';},TypeError);
    return {text:'reply'};
  }});
  const preview=await f.lifecycle.preview(input); const begun=start(f.lifecycle,preview);
  assert.equal((await f.lifecycle.result(begun.requestId)).delivery,'delivered');
  assert.equal(captured.provider.secret,'SYNTHETIC-NOT-REAL');
});
