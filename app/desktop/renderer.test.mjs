import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('renderer exposes B workspace regions and ordinary chat bridge', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const id of ['sidebar', 'conversation-list', 'case-list', 'message-stream', 'composer', 'composer-input', 'attachment-chips', 'evidence-rail', 'provider-badge', 'scope-badge', 'send', 'confirmation', 'settings-dialog']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  const renderer = await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /listConversations/);
  assert.match(renderer, /createConversation/);
  assert.match(renderer, /previewChat/);
  assert.match(renderer, /sendChat/);
  assert.match(renderer, /selectedEvidenceIds/);
  assert.doesNotMatch(renderer, /fetch\(|XMLHttpRequest|sendBeacon/);
});

