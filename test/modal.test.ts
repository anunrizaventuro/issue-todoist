import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMANDS } from '../src/commands.ts';
import { MAX_ATTACHMENTS } from '../src/discord.ts';
import { handleInteraction } from '../src/handler.ts';
import { env, GUILD, noopWaitUntil, signed } from './helpers.ts';

const APPLICATION_COMMAND = 2;
const RESPONSE_MODAL = 9;
const COMPONENT_LABEL = 18;
const COMPONENT_TEXT_INPUT = 4;
const COMPONENT_FILE_UPLOAD = 19;
const STYLE_PARAGRAPH = 2;
const STYLE_SHORT = 1;

const call = (req: Request) => handleInteraction(req, env, noopWaitUntil);

async function modalComponents(): Promise<any[]> {
  const res = await call(signed({ type: APPLICATION_COMMAND, guild_id: GUILD, data: { name: 'issue' } }));
  return ((await res.json()) as any).data.components;
}

const openModal = () =>
  call(signed({ type: APPLICATION_COMMAND, guild_id: GUILD, data: { name: 'issue' } }));

/** By custom_id rather than position, so reordering the form breaks nothing. */
async function field(customId: string): Promise<any> {
  const found = (await modalComponents()).find((c) => c.component.custom_id === customId);
  assert.ok(found, `no field with custom_id ${customId}`);
  return found;
}

test('/issue responds with a modal titled Input Issue', async () => {
  const res = await openModal();
  assert.equal(res.status, 200);

  const body = (await res.json()) as any;
  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, 'issue:issue');
  assert.equal(body.data.title, 'Input Issue');
});

test('every field sits inside a Label, not an Action Row', async () => {
  // Action Rows are deprecated for modal inputs; Discord expects a Label.
  const components = await modalComponents();

  assert.equal(components.length, 5);
  assert.ok(components.length <= 5, 'Discord caps a modal at 5 components — this is the ceiling');
  for (const component of components) {
    assert.equal(component.type, COMPONENT_LABEL);
  }
});

test('the form asks for title, url, acceptance, why and images in that order', async () => {
  const ids = (await modalComponents()).map((c: any) => c.component.custom_id);
  assert.deepEqual(ids, ['title', 'page_url', 'raw_input', 'why', 'attachments']);
});

test('no field carries a sub-line under its label', async () => {
  // A description under every field doubled the length of the form. What the
  // sub-line said now lives in the label or in the placeholder.
  for (const component of await modalComponents()) {
    assert.equal(
      component.description,
      undefined,
      `${component.component.custom_id} still has a description`,
    );
  }
});

test('every label stands on its own and fits the 45-character cap', async () => {
  for (const component of await modalComponents()) {
    assert.ok(component.label.length <= 45, `${component.label} is over 45 characters`);
    // Without a sub-line there is nothing else to read, so a bare word that
    // could mean anything is not enough.
    assert.ok(component.label.length >= 6, `${component.label} says too little on its own`);
  }
});

test('the fields that can hold a hint carry one', async () => {
  // The placeholder is the only place left for an example, so a text field
  // without one now teaches the reporter nothing.
  for (const id of ['title', 'page_url', 'raw_input', 'why']) {
    const { component } = await field(id);
    assert.ok(component.placeholder, `${id} has no placeholder to explain itself`);
    assert.ok(component.placeholder.length <= 100, `${id} placeholder is over 100 characters`);
  }
});

test('the title is the only field the reporter must fill in', async () => {
  const required = (await modalComponents())
    .filter((c: any) => c.component.required === true)
    .map((c: any) => c.component.custom_id);
  assert.deepEqual(required, ['title']);
});

test('the title is required and capped where Todoist truncates', async () => {
  const title = await field('title');
  assert.equal(title.component.type, COMPONENT_TEXT_INPUT);
  assert.equal(title.component.style, STYLE_SHORT);
  assert.equal(title.component.required, true);
  assert.equal(title.component.max_length, 100, 'clipTitle enforces the same ceiling');
});

test('the description is an optional paragraph', async () => {
  // A one-line report is still a report; a required field people have nothing
  // to put in just gets filled with noise.
  const text = await field('raw_input');
  assert.equal(text.component.type, COMPONENT_TEXT_INPUT);
  assert.equal(text.component.style, STYLE_PARAGRAPH);
  assert.equal(text.component.required, false);
  assert.equal(text.component.min_length, undefined, 'a floor would make it required in practice');
  assert.equal(text.component.max_length, 4000);
});

test('the why field is an optional paragraph', async () => {
  const why = await field('why');
  assert.equal(why.component.style, STYLE_PARAGRAPH);
  assert.equal(why.component.required, false);
  assert.equal(why.component.max_length, 1000);
});

test('the image field is optional', async () => {
  // File Upload defaults to required:true inside modals, which would block
  // every text-only issue. This must stay explicitly false.
  const files = await field('attachments');
  assert.equal(files.component.type, COMPONENT_FILE_UPLOAD);
  assert.equal(files.component.custom_id, 'attachments');
  assert.equal(files.component.required, false);
  assert.equal(files.component.min_values, 0);
  assert.equal(files.component.max_values, MAX_ATTACHMENTS);
});

test('the URL field is an optional single-line input', async () => {
  // Most issues are not about one specific page, so requiring this would make
  // the form heavier for the common case.
  const url = await field('page_url');
  assert.equal(url.component.type, COMPONENT_TEXT_INPUT);
  assert.equal(url.component.style, STYLE_SHORT);
  assert.equal(url.component.custom_id, 'page_url');
  assert.equal(url.component.required, false);
  assert.equal(url.component.max_length, 500);
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
