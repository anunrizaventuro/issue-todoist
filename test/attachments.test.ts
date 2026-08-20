import assert from 'node:assert/strict';
import test from 'node:test';

import { attachToTask, MAX_UPLOAD_BYTES, uploadAttachments } from '../src/todoist.ts';
import type { DiscordAttachment } from '../src/interaction.ts';

function file(overrides: Partial<DiscordAttachment> = {}): DiscordAttachment {
  return {
    id: '1',
    filename: 'shot.png',
    size: 1234,
    url: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
    proxy_url: 'https://media.discordapp.net/attachments/1/2/shot.png',
    content_type: 'image/png',
    ...overrides,
  };
}

/** Replaces global fetch for one test and records what was asked of it. */
function stubFetch(handler: (url: string, init: any) => Response) {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    seen.push(url);
    return handler(url, init);
  }) as any;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

/** Shape verified against the live API on 2026-08-20. */
const uploadedBody = {
  file_name: 'shot.png',
  file_size: 1234,
  file_type: 'image/png',
  file_url: 'https://files.todoist.com/abc/as/file.png',
  resource_type: 'image',
  upload_state: 'completed',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('an image is fetched from Discord and handed to Todoist', async () => {
  const f = stubFetch((url) =>
    url.includes('discord') ? new Response(new Uint8Array([1, 2, 3])) : json(uploadedBody),
  );
  try {
    const outcome = await uploadAttachments('tok', [file()]);
    assert.equal(outcome.uploaded.length, 1);
    assert.equal(outcome.uploaded[0]!.file_url, uploadedBody.file_url);
    assert.equal(outcome.failed.length, 0);
    assert.ok(f.seen.some((u) => u.includes('api.todoist.com/api/v1/uploads')));
  } finally {
    f.restore();
  }
});

test('a file over the plan limit is skipped without downloading it', async () => {
  const f = stubFetch(() => new Response('should not happen', { status: 500 }));
  try {
    const outcome = await uploadAttachments('tok', [file({ size: MAX_UPLOAD_BYTES + 1 })]);
    assert.equal(outcome.uploaded.length, 0);
    assert.equal(outcome.failed.length, 1);
    assert.equal(f.seen.length, 0, 'paying to download a file we cannot upload is pure waste');
  } finally {
    f.restore();
  }
});

test('a rejected upload comes back as failed rather than thrown', async () => {
  const f = stubFetch((url) =>
    url.includes('discord') ? new Response(new Uint8Array([1])) : new Response('nope', { status: 413 }),
  );
  try {
    const outcome = await uploadAttachments('tok', [file()]);
    assert.equal(outcome.uploaded.length, 0);
    assert.equal(outcome.failed.length, 1, 'the task is already saved — this must never throw');
  } finally {
    f.restore();
  }
});

test('an upload Todoist did not finish is not treated as usable', async () => {
  const f = stubFetch((url) =>
    url.includes('discord')
      ? new Response(new Uint8Array([1]))
      : json({ ...uploadedBody, upload_state: 'pending' }),
  );
  try {
    const outcome = await uploadAttachments('tok', [file()]);
    assert.equal(outcome.uploaded.length, 0);
    assert.equal(outcome.failed.length, 1);
  } finally {
    f.restore();
  }
});

test('one bad file does not take the good ones with it', async () => {
  let call = 0;
  const f = stubFetch((url) => {
    if (url.includes('discord')) return new Response(new Uint8Array([1]));
    call++;
    return call === 1 ? new Response('nope', { status: 500 }) : json(uploadedBody);
  });
  try {
    const outcome = await uploadAttachments('tok', [file({ id: 'a' }), file({ id: 'b' })]);
    assert.equal(outcome.uploaded.length, 1);
    assert.equal(outcome.failed.length, 1);
  } finally {
    f.restore();
  }
});

test('attaching posts one comment per uploaded file', async () => {
  const bodies: any[] = [];
  const f = stubFetch((_url, init) => {
    bodies.push(JSON.parse(init.body));
    return json({ id: '1' });
  });
  try {
    const attached = await attachToTask('tok', '99', [uploadedBody, uploadedBody]);
    assert.equal(attached, 2);
    assert.equal(bodies[0].task_id, '99');
    assert.deepEqual(bodies[0].attachment, uploadedBody);
    // Verified against the live API: a comment carrying only an attachment is
    // refused with ARGUMENT_MISSING.
    assert.equal(bodies[0].content, 'shot.png', 'content is required by Todoist');
  } finally {
    f.restore();
  }
});

test('a comment Todoist refuses is counted, not thrown', async () => {
  const f = stubFetch(() => new Response('nope', { status: 400 }));
  try {
    assert.equal(await attachToTask('tok', '99', [uploadedBody]), 0);
  } finally {
    f.restore();
  }
});
