import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMANDS } from '../src/commands.ts';
import { MAX_ATTACHMENTS } from '../src/discord.ts';
import { handleInteraction } from '../src/handler.ts';
import { env, noopWaitUntil, signed } from './helpers.ts';

const APPLICATION_COMMAND = 2;
const RESPONSE_MODAL = 9;
const COMPONENT_LABEL = 18;
const COMPONENT_TEXT_INPUT = 4;
const COMPONENT_FILE_UPLOAD = 19;
const STYLE_PARAGRAPH = 2;

const call = (req: Request) => handleInteraction(req, env, noopWaitUntil);

async function modalComponents(): Promise<any[]> {
  const res = await call(signed({ type: APPLICATION_COMMAND, data: { name: 'development' } }));
  return ((await res.json()) as any).data.components;
}

const openModal = () =>
  call(signed({ type: APPLICATION_COMMAND, data: { name: 'development' } }));

test('/development responds with a modal titled Input Issue', async () => {
  const res = await openModal();
  assert.equal(res.status, 200);

  const body = (await res.json()) as any;
  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, 'issue:development');
  assert.equal(body.data.title, 'Input Issue');
});

test('both fields sit inside Labels, not Action Rows', async () => {
  // Action Rows are deprecated for modal inputs; Discord expects a Label.
  const components = await modalComponents();

  assert.equal(components.length, 2);
  for (const component of components) {
    assert.equal(component.type, COMPONENT_LABEL);
  }
});

test('the text field is a required paragraph with a length floor', async () => {
  const [text] = await modalComponents();
  assert.equal(text.component.type, COMPONENT_TEXT_INPUT);
  assert.equal(text.component.style, STYLE_PARAGRAPH);
  assert.equal(text.component.custom_id, 'raw_input');
  assert.equal(text.component.required, true);
  assert.equal(text.component.min_length, 10);
  assert.equal(text.component.max_length, 4000);
});

test('the image field is optional', async () => {
  // File Upload defaults to required:true inside modals, which would block
  // every text-only issue. This must stay explicitly false.
  const [, files] = await modalComponents();
  assert.equal(files.component.type, COMPONENT_FILE_UPLOAD);
  assert.equal(files.component.custom_id, 'attachments');
  assert.equal(files.component.required, false);
  assert.equal(files.component.min_values, 0);
  assert.equal(files.component.max_values, MAX_ATTACHMENTS);
});

test('unknown command gets an ephemeral reply instead of a modal', async () => {
  const res = await call(signed({ type: APPLICATION_COMMAND, data: { name: 'nope' } }));
  const body = (await res.json()) as any;
  assert.equal(body.type, 4);
  assert.equal(body.data.flags, 64, 'reply must be ephemeral');
});

test('a command name cannot be forged through prototype keys', async () => {
  // `'toString' in COMMANDS` is true — a naive lookup would accept it.
  const res = await call(signed({ type: APPLICATION_COMMAND, data: { name: 'toString' } }));
  assert.equal(((await res.json()) as any).type, 4);
});

// Guards future entries (/bug, /design, ...) against Discord's silent caps.
for (const [name, config] of Object.entries(COMMANDS)) {
  test(`/${name} config stays within Discord's limits`, () => {
    assert.ok(config.modalTitle.length <= 45, 'modal title max 45 chars');
    assert.ok(config.fieldLabel.length <= 45, 'label max 45 chars');
    assert.ok(config.placeholder.length <= 100, 'placeholder max 100 chars');
    assert.ok(config.description.length <= 100, 'command description max 100 chars');
    assert.ok(`issue:${name}`.length <= 100, 'custom_id max 100 chars');
    assert.ok(/^[a-z0-9_-]{1,32}$/.test(name), 'command name must be lowercase, max 32 chars');
  });
}
