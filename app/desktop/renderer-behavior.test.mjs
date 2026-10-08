import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';

test('desktop content policy refuses all embedded frame documents', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const policy = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/.exec(html)?.[1];
  assert.match(policy, /(?:^|;)\s*frame-src\s+'none'\s*(?:;|$)/);
});

// Minimal DOM interface double; actual renderer executes unchanged. Native Chromium follows separately.
async function fixture({delivery = 'unknown', messages = [], segments = [], attachments = [], attachmentParts = [], previewFails = false, startFails = false, reloadFails = false, firstUse=false, storageFails=false} = {}) {
  const all = []; const sinks = [];
  class Element {
    constructor(tag='div',id='') { this.tagName=tag; this.id=id; this.children=[]; this.listeners=new Map(); this.value=''; this.dataset={}; this.disabled=false; this.classList={toggle(){}}; all.push(this); }
    set innerHTML(value) { sinks.push(value); this.html=value; }
    get textContent() { return (this.text??'')+this.children.map((c) => c.textContent).join(''); }
    set textContent(value) {this.text=String(value); this.children=[];}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children=[...children]; this.text='';}
    addEventListener(name,fn) { if(!this.listeners.has(name)) this.listeners.set(name,[]); this.listeners.get(name).push(fn); }
    async emit(name,event={preventDefault(){}}) {await Promise.all((this.listeners.get(name)??[]).map((fn) => fn(event)));}
    showModal() {this.open=true;} close() {this.open=false;}
  }
  const html = await readFile(new URL('./index.html',import.meta.url),'utf8');
  const elements = new Map([...html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)].map((m) => [m[2],new Element(m[1],m[2])]));
  assert.ok(elements.has('cancel-request'), 'real HTML must provide the running cancellation control');
  const document = {querySelector:(selector) => elements.get(selector.slice(1)),createElement:(tag) => new Element(tag),querySelectorAll:() => all};
  let resolveResult; const outcome = new Promise((resolve) => {resolveResult=resolve;});
  const calls = {starts:[],aborts:[],previews:[],loads:[],discarded:[],providers:[]};
  const malicious = '<img src=x onerror=steal()>', conversation = {id:'c1',title:'Local',caseId:null,messages,segments};
  const manbo = {
    saveProvider:async (config,secret) => {calls.providers.push({config,secret});},
    listProviders:async () => [{id:'p',name:malicious,model:malicious,hasKey:true}],
    listCases:async () => [], listConversations:async () => [{id:'c1',title:'Local',messageCount:messages.length,caseId:null}],
    loadConversationRecord:async (id) => {calls.loads.push(id); if(reloadFails && calls.loads.length > 1) throw new Error('private echoed prompt'); return {...conversation,id};},
    previewChat:async (input) => { calls.previews.push(input); if(previewFails) throw new Error('private echoed prompt'); return {receiptId:'r1',provider:'p',model:malicious,receiver:{name:malicious,endpoint:'https://example.test/v1'},prompt:input.draft.prompt,scope:{evidenceIds:[]},attachments,attachmentParts,contextMessages:messages.filter((m) => input.draft.contextMessageIds.includes(m.id))};},
    sendChat:async (input) => {calls.starts.push(input); if(startFails) throw new Error('private echoed prompt'); return {requestId:'req1'};},
    waitChat:async () => outcome,
    abortChat:async (id) => {calls.aborts.push(id); resolveResult({delivery,requestId:id}); return {aborted:true};},
    discardChatPreview:async (id) => {calls.discarded.push(id);},
  };
  const stored=new Map(firstUse?[]:[['manbo-notice-v1','accepted']]);
  const localStorage={getItem(key){if(storageFails)throw new Error('storage unavailable');return stored.get(key)??null;},setItem(key,value){if(storageFails)throw new Error('storage unavailable');stored.set(key,value);}};
  new Script(await readFile(new URL('./renderer.js',import.meta.url),'utf8')).runInNewContext({document,window:{manbo,localStorage}});
  const flush = () => new Promise((resolve) => setImmediate(resolve)); await flush(); await flush();
  const input = elements.get('composer-input'); input.value='keep draft'; await input.emit('input');
  return {elements,calls,sinks,flush,stored,resolve:() => resolveResult({delivery,requestId:'req1'})};
}

test('first-use notice gates conversation and sending until explicit local acknowledgement',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/<dialog\b[^>]*id="privacy-notice"[^>]*closedby="none"/,'native Escape close requests must be disabled, including noncancelable cancel events');
  const f=await fixture({firstUse:true});
  assert.equal(f.elements.get('privacy-notice')?.open,true,'first-use dialog must be shown');
  assert.equal(f.calls.loads.length,0);
  await f.elements.get('send').emit('click');
  assert.equal(f.calls.previews.length,0);
  await f.elements.get('privacy-notice').emit('cancel');
  assert.equal(f.elements.get('privacy-notice').open,true);
  await f.elements.get('accept-privacy').emit('click');
  await f.flush();
  assert.equal(f.stored.get('manbo-notice-v1'),'accepted');
  assert.equal(f.elements.get('privacy-notice').open,false);
  assert.equal(f.calls.loads.length,1);
});

test('unavailable local acknowledgement storage never silently hides the first-use notice',async()=>{
  const f=await fixture({storageFails:true,firstUse:true});
  assert.equal(f.elements.get('privacy-notice')?.open,true);
  await f.elements.get('accept-privacy').emit('click');
  await f.flush();
  assert.equal(f.calls.loads.length,1);
  assert.equal(f.stored.has('manbo-notice-v1'),false);
});

test('Alpha provider settings cannot advertise unverified image input',async()=>{
  const f=await fixture();
  const oldImageControl=f.elements.get('provider-images');
  if(oldImageControl) oldImageControl.checked=true;
  await f.elements.get('save-provider').emit('click');
  assert.equal(f.calls.providers.length,1);
  assert.equal(f.calls.providers[0].config.capabilities.images,false);
  assert.equal(f.elements.has('provider-images'),false,'unsupported capability has no selectable checkbox');
});

test('confirmation renders provider/model/history as plain text, never dynamic HTML', async () => {
  const f = await fixture({messages:[{id:'m1',role:'assistant',text:'Exact earlier answer',evidenceIds:[]}]});
  await f.elements.get('send').emit('click');
  assert.equal(f.sinks.some((value) => value.includes('onerror')),false);
  assert.match(f.elements.get('confirmation-copy').textContent,/Exact earlier answer/);
  assert.deepEqual(Array.from(f.calls.previews[0].draft.contextMessageIds),['m1']);
});

test('confirmation shows exact attachment body and hash as plain text without truncation', async () => {
  const text = '[材料：synthetic.html]\n<img src=x onerror=steal()>\n' + 'Synthetic body '.repeat(2000) + '\nEND OF ATTACHMENT';
  const sha256 = 'a'.repeat(64);
  const f = await fixture({
    attachments: [{ name: 'synthetic.html', representation: 'extracted-text', bytes: text.length, sha256 }],
    attachmentParts: [{ type: 'text', text }],
  });
  await f.elements.get('send').emit('click');
  const displayed = f.elements.get('confirmation-copy').textContent;
  assert.ok(displayed.includes(text), 'full authorized attachment body must be visible');
  assert.ok(displayed.includes(sha256), 'computed source hash must be visible');
  assert.equal(f.sinks.some((value) => value.includes('onerror')), false);
});

test('double confirmation starts once and cannot switch the captured conversation', async () => {
  const f = await fixture(); await f.elements.get('send').emit('click');
  const a = f.elements.get('accept-confirm').emit('click'); const b = f.elements.get('accept-confirm').emit('click');
  await f.flush();
  const nav = f.elements.get('conversation-list').children[0]; await nav.emit('click'); await f.flush();
  assert.equal(f.calls.starts.length,1); assert.equal(f.calls.loads.length,1);
  assert.equal(f.calls.starts[0].receiptId,'r1');
  f.resolve(); await Promise.all([a,b]);
});

test('running cancellation uses early ID and retains draft on unknown delivery', async () => {
  const f = await fixture(); await f.elements.get('send').emit('click');
  const running = f.elements.get('accept-confirm').emit('click'); await f.flush();
  await f.elements.get('cancel-request').emit('click'); f.resolve(); await running;
  assert.deepEqual(f.calls.aborts,['req1']); assert.equal(f.elements.get('composer-input').value,'keep draft');
  assert.match(f.elements.get('status').textContent,/不确定/);
});

test('confirmation cancellation discards receipt and performs no send', async () => {
  const f = await fixture(); await f.elements.get('send').emit('click'); await f.elements.get('cancel-confirm').emit('click');
  assert.deepEqual(f.calls.discarded,['r1']); assert.equal(f.calls.starts.length,0);
  assert.equal(f.elements.get('composer-input').value,'keep draft');
});

test('history selection excludes segment sources and incomplete deliveries and caps clean history at 40', async () => {
  const messages=[{id:'sensitive',segmentId:'s1',role:'assistant',text:'SECRET HISTORY',evidenceIds:[]},
    {id:'uncertain',role:'user',text:'UNDELIVERED',evidenceIds:[],delivery:{status:'unknown'}},
    ...Array.from({length:41},(_,i) => ({id:`clean${i}`,role:'user',text:`clean ${i}`,evidenceIds:[]}))];
  const f=await fixture({messages,segments:[{id:'s1',evidenceIds:['e1']}]});
  await f.elements.get('send').emit('click');
  assert.deepEqual(Array.from(f.calls.previews[0].draft.contextMessageIds),messages.slice(-40).map((m) => m.id));
  assert.doesNotMatch(f.elements.get('confirmation-copy').textContent,/SECRET HISTORY|UNDELIVERED/);
  assert.match(f.elements.get('confirmation-copy').textContent,/3 条未授权/);
});

test('Escape discards confirmation, unlocks controls and does not send', async () => {
  const f=await fixture(); await f.elements.get('send').emit('click');
  await f.elements.get('confirmation').emit('cancel'); await f.flush();
  assert.deepEqual(f.calls.discarded,['r1']); assert.equal(f.calls.starts.length,0);
  assert.equal(f.elements.get('composer-input').disabled,false);
});

for(const options of [{previewFails:true},{startFails:true}]) test('IPC rejection is caught without leaking error or clearing draft '+JSON.stringify(options),async () => {
  const f=await fixture(options); await f.elements.get('send').emit('click');
  if(options.startFails) await f.elements.get('accept-confirm').emit('click');
  assert.equal(f.elements.get('composer-input').value,'keep draft');
  assert.doesNotMatch(f.elements.get('status').textContent,/private|echoed/);
  assert.equal(f.elements.get('composer-input').disabled,false);
});

test('busy new-chat, import and settings controls do not invoke mutations',async () => {
  const f=await fixture(); await f.elements.get('send').emit('click');
  await f.elements.get('new-chat').emit('click'); await f.elements.get('import-evidence').emit('click');
  await f.elements.get('settings').emit('click');
  assert.equal(f.elements.get('settings-dialog').open,undefined);
  assert.equal(f.calls.loads.length,1);
});

test('delivered result clears draft only after successful local refresh',async () => {
  const f=await fixture({delivery:'delivered'}); await f.elements.get('send').emit('click');
  const running=f.elements.get('accept-confirm').emit('click'); await f.flush(); f.resolve(); await running;
  assert.equal(f.elements.get('composer-input').value,'');
  assert.match(f.elements.get('status').textContent,/已发送并收到/);
});

test('failed refresh after delivered result retains draft and does not falsely call delivery unknown',async () => {
  const f=await fixture({delivery:'delivered',reloadFails:true}); await f.elements.get('send').emit('click');
  const running=f.elements.get('accept-confirm').emit('click'); await f.flush(); f.resolve(); await running;
  assert.equal(f.elements.get('composer-input').value,'keep draft');
  assert.match(f.elements.get('status').textContent,/已发送并保存/);
  assert.doesNotMatch(f.elements.get('status').textContent,/发送状态不确定|private/);
});
