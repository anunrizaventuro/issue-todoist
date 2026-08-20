import assert from 'node:assert/strict';
import test from 'node:test';

import type { Draft } from '../src/draft.ts';
import { fromRawInput } from '../src/issue.ts';
import { cancelledMessage, closedMessage, reviewMessage } from '../src/review.ts';

const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    status: 'pending',
    issue: { ...fromRawInput('kodepos tidak terisi otomatis'), title: 'Kodepos kosong' },
    context: {
      command: 'issue',
      rawInput: 'kodepos tidak terisi otomatis',
      author: 'rifa',
      filedBy: null,
      sourceLink: null,
      typedTitle: null,
      why: null,
      pageUrl: null,
      attachments: [],
      normalized: true,
    },
    reporterId: '123',
    applicationId: '1',
    token: 'tok',
    taskUrl: null,
    ...overrides,
  };
}

const flat = (message: any) => message.components.flatMap((row: any) => row.components);

test('the card carries every action the reporter can take', () => {
  const ids = flat(reviewMessage(draft(), 10)).map((c: any) => c.custom_id);
  assert.deepEqual(ids, [
    `d:ok:${ID}`,
    `d:edit:${ID}`,
    `d:ai:${ID}`,
    `d:rw:${ID}`,
    `d:x:${ID}`,
    `d:pr:${ID}`,
  ]);
  const buttons = (reviewMessage(draft(), 10) as any).components[0].components;
  assert.ok(buttons.length <= 5, 'Discord caps an Action Row at 5 buttons');
});

test('the card says when it will file itself', () => {
  const message: any = reviewMessage(draft(), 10);
  assert.match(JSON.stringify(message.embeds[0]), /10 menit/);
});

test('the card is ephemeral', () => {
  assert.equal((reviewMessage(draft(), 10) as any).flags, 64);
});

test('the priority dropdown marks the one the model chose', () => {
  const card = reviewMessage(draft({ issue: { ...fromRawInput('x'), priority: 3 } }), 10);
  const select: any = flat(card).find((c: any) => c.type === 3);
  assert.equal(select.options.filter((o: any) => o.default).length, 1, 'exactly one default');
  assert.equal(select.options.find((o: any) => o.default).value, '3');
});

test('everything that would be filed is shown, so nothing is approved unseen', () => {
  const card: any = reviewMessage(
    draft({
      issue: {
        ...fromRawInput('kodepos kosong'),
        title: 'Kodepos kosong',
        expected: 'terisi dari kelurahan',
        action: 'pilih kelurahan di checkout',
        dueString: 'tomorrow',
        url: 'https://app.example.com/checkout',
        subtasks: ['pecah alamat jadi bertingkat', 'isi kodepos otomatis'],
        needsClarification: true,
        clarification: 'kelurahan mana yang dicoba?',
      },
    }),
    10,
  );
  const text = JSON.stringify(card.embeds[0]);

  for (const shown of [
    'terisi dari kelurahan',
    'pilih kelurahan di checkout',
    'tomorrow',
    'app.example.com/checkout',
    'pecah alamat jadi bertingkat',
    'kelurahan mana yang dicoba?',
  ]) {
    assert.ok(text.includes(shown), `missing from the card: ${shown}`);
  }
});

test('an un-normalized draft is flagged rather than presented as tidy', () => {
  const base = draft();
  const message: any = reviewMessage(
    draft({ context: { ...base.context, normalized: false } }),
    10,
  );
  assert.match(JSON.stringify(message.embeds[0]), /belum dirapikan|tidak sempat merapikan/i);
});

test('a closed draft offers its task instead of dead buttons', () => {
  const message: any = closedMessage(
    draft({ status: 'filed', taskUrl: 'https://app.todoist.com/app/task/9' }),
  );
  assert.equal(flat(message).length, 1);
  assert.equal(flat(message)[0].url, 'https://app.todoist.com/app/task/9');
  assert.ok(!JSON.stringify(message).includes(`d:ok:${ID}`), 'buttons must be gone');
});

test('a closed draft with no task at all still renders', () => {
  const message: any = closedMessage(draft({ status: 'cancelled' }));
  assert.equal(message.components.length, 0);
  assert.match(JSON.stringify(message.embeds[0]), /dibatalkan/i);
});

test('cancelling hands the text back so nothing is lost', () => {
  const message: any = cancelledMessage(draft({ status: 'cancelled' }));
  assert.match(JSON.stringify(message.embeds[0]), /kodepos tidak terisi otomatis/);
  assert.equal(message.components.length, 0);
});
