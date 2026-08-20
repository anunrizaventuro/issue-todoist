import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, renderDescription, type IssueContext } from '../src/issue.ts';

const base: Omit<IssueContext, 'normalized'> = {
  command: 'issue',
  rawInput: 'tombol checkout ga muncul di mobile',
  author: 'rifa',
  authorUsername: null,
  filedBy: null,
  filedByUsername: null,
  sourceLink: 'https://discord.com/channels/1/2',
  typedTitle: null,
  why: null,
  pageUrl: null,
  attachments: [],
};

test('title falls back to the first non-empty line', () => {
  const issue = fromRawInput('\n\n  checkout mobile error  \nkayaknya ketutup\ncoba cek');
  assert.equal(issue.title, 'checkout mobile error');
});

test('a long title is cut at a word boundary, never mid-word', () => {
  const long = `${'panjang '.repeat(20)}selesai`;
  const { title } = fromRawInput(long);
  assert.ok(title.length <= 100, `got ${title.length}`);
  assert.ok(title.endsWith('…'));
  assert.ok(!/\bpanjan…$/.test(title), 'must not slice mid-word');
});

test('a report with nothing but text still renders its origin and quote', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false });

  assert.ok(body.includes(base.rawInput), 'the user text must survive verbatim');
  assert.ok(body.includes('@rifa'));
});

test('the description carries only what the title and child tasks cannot', () => {
  const issue = {
    ...fromRawInput(base.rawInput),
    url: 'https://toko.example.com/keranjang',
    why: 'pelanggan batal checkout',
    acceptance: ['Tombol checkout terlihat di mobile'],
  };
  const body = renderDescription(issue, { ...base, normalized: true });

  assert.ok(body.includes('**Halaman**'));
  assert.ok(body.includes('**Kenapa penting**'));
  assert.ok(
    !body.includes('Tombol checkout terlihat di mobile'),
    'acceptance belongs to the child tasks, not repeated here',
  );
  assert.ok(body.includes('> tombol checkout ga muncul di mobile'), 'original must be preserved');
});

test('the original text is quoted even when the model ran', () => {
  // With `problem` gone this quote is the only narrative record of what was
  // actually reported, so it must not depend on normalization succeeding.
  const issue = { ...fromRawInput(base.rawInput), acceptance: ['apa pun'] };

  for (const normalized of [true, false]) {
    const body = renderDescription(issue, { ...base, normalized });
    assert.ok(body.includes('**Tulisan asli:**'), `hilang saat normalized=${normalized}`);
  }
});

test('attachments are listed with their expiry warning', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, {
    ...base,
    normalized: false,
    attachments: [
      {
        id: '1',
        filename: 'shot.png',
        size: 1024,
        url: 'https://cdn.discordapp.com/x.png?ex=1',
        proxy_url: 'https://media.discordapp.net/x.png',
      },
    ],
  });

  assert.ok(body.includes('[shot.png](https://cdn.discordapp.com/x.png?ex=1)'));
  assert.ok(body.includes('kedaluwarsa'), 'expiring links must be labelled as such');
});

test('a filer different from the writer is credited separately', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false, filedBy: 'anun' });

  assert.ok(body.includes('@rifa'), 'the person who wrote it stays the reporter');
  assert.ok(body.includes('dicatat oleh @anun'));
});

test('no filer credit is shown when the same person did both', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false, filedBy: null });
  assert.ok(!body.includes('dicatat oleh'));
});

test('fromRawInput invents neither a URL nor acceptance criteria', () => {
  const issue = fromRawInput('checkout ketutup navbar di https://toko.example.com/keranjang');
  assert.equal(issue.url, null, 'the raw path must not parse anything out of the text');
  assert.deepEqual(issue.acceptance, [], 'splitting a report apart is the model\'s job alone');
});

test('the page URL gets its own section', () => {
  const issue = { ...fromRawInput(base.rawInput), url: 'https://toko.example.com/keranjang' };
  const body = renderDescription(issue, { ...base, normalized: true });

  assert.ok(body.includes('**Halaman**'));
  assert.ok(body.includes('https://toko.example.com/keranjang'));
});

test('the page URL still shows on the raw path, where it came from the form', () => {
  // The form field is filled by the reporter, so it is real even when no model
  // ran and the text itself was passed through untouched.
  const issue = { ...fromRawInput(base.rawInput), url: 'https://toko.example.com/keranjang' };
  const body = renderDescription(issue, { ...base, normalized: false });

  assert.ok(body.includes('**Halaman**'));
});

test('no Halaman heading is left behind when there is no URL', () => {
  const body = renderDescription(fromRawInput(base.rawInput), { ...base, normalized: true });
  assert.ok(!body.includes('**Halaman**'));
});

test('images already in Todoist are not repeated as dying Discord links', () => {
  const attachment = {
    id: '1',
    filename: 'shot.png',
    size: 10,
    url: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
    proxy_url: 'https://media.discordapp.net/attachments/1/2/shot.png',
    content_type: 'image/png',
  };
  const context = { ...base, attachments: [attachment], normalized: true };
  const issue = fromRawInput('kodepos kosong');

  const uploaded = renderDescription(issue, context, []);
  assert.ok(!uploaded.includes('cdn.discordapp.com'), 'an image Todoist holds needs no link');
  assert.ok(!uploaded.includes('kedaluwarsa'));

  const stranded = renderDescription(issue, context, [attachment]);
  assert.ok(stranded.includes('cdn.discordapp.com'), 'a failed upload must still leave a link');
  assert.ok(stranded.includes('kedaluwarsa'));
});

test('by default every attachment is still written as a link', () => {
  // Guards the old call sites: omitting the argument must not silently drop images.
  const attachment = {
    id: '1', filename: 'shot.png', size: 10,
    url: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
    proxy_url: 'x', content_type: 'image/png',
  };
  const body = renderDescription(fromRawInput('kodepos kosong'), {
    ...base, attachments: [attachment], normalized: true,
  });
  assert.ok(body.includes('cdn.discordapp.com'));
});

test('the reporter\'s own reason is filed verbatim under its own heading', () => {
  const issue = { ...fromRawInput('kodepos kosong'), why: 'pelanggan batal checkout' };
  const body = renderDescription(issue, { ...base, normalized: true });

  assert.match(body, /\*\*Kenapa penting\*\*/);
  assert.match(body, /pelanggan batal checkout/);
});

test('no why means no empty heading', () => {
  const body = renderDescription(fromRawInput('kodepos kosong'), { ...base, normalized: true });
  assert.ok(!body.includes('Kenapa penting'));
});
