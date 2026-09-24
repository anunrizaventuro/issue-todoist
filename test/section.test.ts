import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, type IssueContext } from '../src/issue.ts';
import { createTask, findSection } from '../src/todoist.ts';

const context: IssueContext = {
  command: 'issue',
  rawInput: 'tombol checkout ketutup navbar',
  author: 'rifa',
  authorUsername: 'rifa',
  filedBy: null,
  filedByUsername: null,
  sourceLink: null,
  // VENTURO #officia → Officia, a project that has a TODO section.
  channelId: '1512274401931034655',
  channelParentId: null,
  typedTitle: null,
  pageUrl: null,
  why: null,
  attachments: [],
  normalized: true,
};

/** Answers the sections lookup with `sections` (or `status`), and records the task body. */
function stubTodoist(sections: { id: string; name: string }[], status = 200) {
  const real = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('/sections')) {
      return new Response(JSON.stringify({ results: sections, next_cursor: null }), { status });
    }
    return new Response('{"id":"42"}', { headers: { 'content-type': 'application/json' } });
  }) as any;

  const task = () => calls.find((c) => c.url.endsWith('/tasks'))!.body;
  return { calls, task, restore: () => { globalThis.fetch = real; } };
}

test('a new task lands in the TODO section of its project', async () => {
  const stub = stubTodoist([
    { id: 's-progress', name: 'IN PROGRESS' },
    { id: 's-todo', name: 'TODO' },
  ]);
  try {
    await createTask('tok', fromRawInput('x'), context);

    const lookup = stub.calls.find((c) => c.url.includes('/sections'))!;
    assert.match(lookup.url, /project_id=6h8gXQGqrXxhj96c/, 'looked up in the project it files into');
    assert.equal(stub.task().section_id, 's-todo');
  } finally {
    stub.restore();
  }
});

test('the section name is matched regardless of case and stray spaces', async () => {
  const stub = stubTodoist([{ id: 's-todo', name: ' Todo ' }]);
  try {
    assert.equal(await findSection('tok', 'p'), 's-todo');
  } finally {
    stub.restore();
  }
});

test('a project without a TODO section still gets the task, in No section', async () => {
  const stub = stubTodoist([{ id: 's-done', name: 'DONE' }]);
  try {
    await createTask('tok', fromRawInput('x'), context);
    assert.equal('section_id' in stub.task(), false);
  } finally {
    stub.restore();
  }
});

test('a failed sections lookup never stops the task from being filed', async () => {
  const stub = stubTodoist([], 500);
  try {
    const created = await createTask('tok', fromRawInput('x'), context);
    assert.equal(created.id, '42');
    assert.equal('section_id' in stub.task(), false);
  } finally {
    stub.restore();
  }
});
