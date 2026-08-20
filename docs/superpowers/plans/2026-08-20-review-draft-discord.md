# Review Draft di Discord — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyisipkan tahap review di Discord antara submit dan Todoist — pelapor melihat draft, lalu approve / edit / minta AI menulis ulang / batal, dan draft yang didiamkan 10 menit tetap masuk Todoist berlabel `needs-review`.

**Architecture:** Satu draft = satu Durable Object bernama UUID. DO menyimpan draft, memasang `alarm()` 10 menit, dan menjadi satu-satunya tempat status berpindah — karena DO dieksekusi berurutan per objek, klik pengguna dan alarm tidak pernah dua-duanya menang. Logika murni (transisi status, parsing `custom_id`, perakitan kartu) tinggal di file tanpa import Workers supaya tetap bisa dites di Node; hanya `draft-object.ts` dan `index.ts` yang menyentuh runtime Cloudflare.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (SQLite backend), `discord-interactions`, `node:test` tanpa framework tambahan.

**Spec:** `docs/superpowers/specs/2026-08-20-review-sebelum-todoist-design.md`

## Global Constraints

- Laporan tidak boleh hilang. Setiap jalur gagal harus tetap berujung task Todoist atau teks asli yang dikembalikan ke pelapor.
- `src/index.ts` dan `src/draft-object.ts` adalah satu-satunya file yang boleh menyentuh runtime Workers (`cloudflare:workers`). Sisanya harus bisa di-import dari `node:test`.
- Semua teks yang dilihat pengguna berbahasa Indonesia. Komentar kode berbahasa Inggris, mengikuti kode yang sudah ada.
- Timeout review: `REVIEW_TIMEOUT_MINUTES`, default `10`. Jangan lebih dari 14 — token interaction Discord mati di menit ke-15 dan alarm tidak akan bisa menyunting pesan draft.
- `custom_id` Discord maksimal 100 karakter.
- Modal Discord maksimal 5 komponen.
- Test dijalankan dengan `npm test` (`node --test test/*.test.ts`). Typecheck dengan `npm run typecheck`.
- Commit setiap akhir task.

---

### Task 1: Modal 4 field dan judul yang diketik pelapor

Berdiri sendiri: setelah task ini alur lama masih jalan utuh (submit langsung ke Todoist), hanya bentuk formnya yang berubah.

**Files:**
- Modify: `src/discord.ts` (tambah `TITLE_ID`, susun ulang `buildIssueModal`)
- Modify: `src/issue.ts:29-40` (`IssueContext` dapat `typedTitle`)
- Modify: `src/process.ts:36` (override judul)
- Modify: `src/handler.ts:117-134` (baca judul dari modal)
- Test: `test/submit.test.ts`

**Interfaces:**
- Consumes: `findValue(components, customId)` dari `src/interaction.ts`, `clipTitle(line)` dari `src/issue.ts`
- Produces:
  - `export const TITLE_ID = 'title'` di `src/discord.ts`
  - `IssueContext.typedTitle: string | null`

- [ ] **Step 1: Write the failing test**

Tambahkan ke `test/submit.test.ts`:

```ts
test('the title typed into the form beats the one the model would pick', async () => {
  const payload = submission('tombol checkout ketutup navbar di mobile');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'title', value: 'Navbar menutupi tombol checkout' },
  });
  const { deferred } = await call(payload);
  await Promise.all(deferred);
  assert.equal(filedTask().content, 'Navbar menutupi tombol checkout');
});

test('a title longer than Todoist keeps is clipped, not dropped', async () => {
  const payload = submission('tombol checkout ketutup navbar di mobile');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'title', value: 'x'.repeat(150) },
  });
  const { deferred } = await call(payload);
  await Promise.all(deferred);
  assert.ok(filedTask().content.length <= 100);
});

test('the modal asks for title, url, description and images in that order', () => {
  const modal = buildIssueModal('issue');
  const ids = modal.data.components.map((c: any) => c.component.custom_id);
  assert.deepEqual(ids, ['title', 'page_url', 'raw_input', 'attachments']);
});
```

Tambahkan `buildIssueModal` ke baris import dari `../src/discord.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/submit.test.ts`
Expected: FAIL — `buildIssueModal` belum di-export dari import, dan judul yang diketik belum terbaca.

- [ ] **Step 3: Susun ulang modal**

Di `src/discord.ts`, tambahkan di dekat `RAW_INPUT_ID`:

```ts
/** custom_id of the title field. */
export const TITLE_ID = 'title';
```

Ganti isi `components` di `buildIssueModal` dengan urutan ini — judul dulu, gambar terakhir:

```ts
components: [
  {
    type: MessageComponentTypes.LABEL,
    label: 'Judul',
    description: 'Satu baris yang bisa dipindai sekilas.',
    component: {
      type: MessageComponentTypes.INPUT_TEXT,
      custom_id: TITLE_ID,
      style: TextStyleTypes.SHORT,
      required: true,
      min_length: 5,
      // Todoist truncates past this, and clipTitle enforces the same ceiling.
      max_length: 100,
      placeholder: config.placeholder,
    },
  },
  {
    type: MessageComponentTypes.LABEL,
    label: 'Halaman terkait (opsional)',
    description: 'URL halaman tempat issue-nya muncul.',
    component: {
      type: MessageComponentTypes.INPUT_TEXT,
      custom_id: PAGE_URL_ID,
      style: TextStyleTypes.SHORT,
      required: false,
      max_length: 500,
      placeholder: 'https://...',
    },
  },
  {
    type: MessageComponentTypes.LABEL,
    label: config.fieldLabel,
    description: 'Kenapa ini masalah? Tulis sebebasnya — sistem yang merapikan.',
    component: {
      type: MessageComponentTypes.INPUT_TEXT,
      custom_id: RAW_INPUT_ID,
      style: TextStyleTypes.PARAGRAPH,
      required: true,
      min_length: 10,
      max_length: 4000,
      placeholder: config.placeholder,
    },
  },
  {
    type: MessageComponentTypes.LABEL,
    label: 'Gambar (opsional)',
    description: 'Screenshot sangat membantu. Maksimal 5 MB per file.',
    component: {
      type: FILE_UPLOAD,
      custom_id: ATTACHMENTS_ID,
      // Defaults to true inside modals, which would block text-only issues.
      required: false,
      min_values: 0,
      max_values: MAX_ATTACHMENTS,
    },
  },
],
```

Ubah `fieldLabel` di `src/commands.ts` dari `'Issue'` jadi `'Deskripsi'`.

- [ ] **Step 4: Alirkan judul sampai ke task**

Di `src/issue.ts`, tambahkan ke `IssueContext` tepat di atas `pageUrl`:

```ts
  /** Title typed into the form. Outranks the one the model produced. */
  typedTitle: string | null;
```

Di `src/process.ts`, ganti baris penyusunan `issue`:

```ts
  // What the reporter typed into the form beats what the model read out of the
  // prose, and survives even when no model ran.
  const issue: NormalizedIssue = {
    ...base,
    title: context.typedTitle ? clipTitle(context.typedTitle) : base.title,
    url: toUrl(context.pageUrl) ?? base.url,
  };
```

Tambahkan `clipTitle` ke import dari `./issue.ts`.

Di `src/handler.ts`, di `handleModalSubmit` setelah `pageUrl`:

```ts
  const typedTitle = findValue(interaction.data.components, TITLE_ID)?.trim() || null;

  // ACK now, work later: everything past this point is outside the 3-second budget.
  waitUntil(createAndReport(interaction, env, command, rawInput, { pageUrl, typedTitle }));
```

Dan di `createAndReport`, tambahkan `typedTitle: null,` ke objek `context` (jalur klik-kanan tidak punya modal, jadi judulnya tetap dari AI). Tambahkan `TITLE_ID` ke import dari `./discord.ts`.

- [ ] **Step 5: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add src/discord.ts src/commands.ts src/issue.ts src/process.ts src/handler.ts test/submit.test.ts
git commit -m "feat: form issue jadi judul, halaman, deskripsi, gambar"
```

---

### Task 2: Bentuk draft dan transisi statusnya

Semuanya fungsi murni. Belum ada yang memanggilnya — task ini menghasilkan fondasi yang dites sendiri.

**Files:**
- Create: `src/draft.ts`
- Test: `test/draft.test.ts`

**Interfaces:**
- Consumes: `NormalizedIssue`, `IssueContext` dari `src/issue.ts`
- Produces:
  - `type DraftStatus = 'pending' | 'filed' | 'cancelled'`
  - `interface Draft { id, status, issue, context, reporterId, applicationId, token, taskUrl }`
  - `interface EditFields { title, url, problem, expected, action }`
  - `type DraftAction = 'ok' | 'edit' | 'rw' | 'pr' | 'x'`
  - `draftCustomId(action: DraftAction, id: string, modal?: boolean): string`
  - `parseDraftCustomId(customId: string | undefined): { action: DraftAction; id: string; modal: boolean } | null`
  - `claim(draft: Draft, status: 'filed' | 'cancelled'): Draft | null`
  - `applyEdit(draft: Draft, fields: EditFields): Draft`
  - `applyPriority(draft: Draft, priority: number): Draft`

- [ ] **Step 1: Write the failing test**

Buat `test/draft.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEdit,
  applyPriority,
  claim,
  draftCustomId,
  parseDraftCustomId,
  type Draft,
} from '../src/draft.ts';
import { fromRawInput } from '../src/issue.ts';

const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    status: 'pending',
    issue: fromRawInput('kodepos tidak terisi otomatis'),
    context: {
      command: 'issue',
      rawInput: 'kodepos tidak terisi otomatis',
      author: 'rifa',
      filedBy: null,
      sourceLink: null,
      typedTitle: null,
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

test('custom_id survives the round trip and stays under Discord limit', () => {
  const id = draftCustomId('ok', ID);
  assert.ok(id.length <= 100, `custom_id is ${id.length} chars`);
  assert.deepEqual(parseDraftCustomId(id), { action: 'ok', id: ID, modal: false });
  assert.deepEqual(parseDraftCustomId(draftCustomId('edit', ID, true)), {
    action: 'edit',
    id: ID,
    modal: true,
  });
});

test('anything that is not a draft custom_id is refused', () => {
  assert.equal(parseDraftCustomId(undefined), null);
  assert.equal(parseDraftCustomId('issue:issue'), null);
  assert.equal(parseDraftCustomId('d:nope:' + ID), null);
  assert.equal(parseDraftCustomId('d:ok:'), null);
});

test('a draft can only be claimed once', () => {
  const filed = claim(draft(), 'filed');
  assert.equal(filed?.status, 'filed');
  // This is what stops a click and the alarm from both filing the same issue.
  assert.equal(claim(filed!, 'filed'), null);
  assert.equal(claim(filed!, 'cancelled'), null);
});

test('a cancelled draft cannot be filed afterwards', () => {
  const cancelled = claim(draft(), 'cancelled')!;
  assert.equal(claim(cancelled, 'filed'), null);
});

test('editing overwrites only the fields the modal carries', () => {
  const before = draft();
  before.issue.subtasks = ['pecahkan alamat jadi bertingkat'];
  const after = applyEdit(before, {
    title: 'Kodepos tidak terisi otomatis',
    url: 'https://app.example.com/checkout',
    problem: 'kodepos kosong terus',
    expected: 'terisi dari kelurahan',
    action: null,
  });

  assert.equal(after.issue.title, 'Kodepos tidak terisi otomatis');
  assert.equal(after.issue.url, 'https://app.example.com/checkout');
  assert.equal(after.issue.expected, 'terisi dari kelurahan');
  assert.equal(after.issue.action, null);
  assert.deepEqual(after.issue.subtasks, ['pecahkan alamat jadi bertingkat'], 'sub-task tidak ikut hilang');
  assert.equal(after.status, 'pending');
});

test('an edit that is not a link leaves the url empty rather than dead', () => {
  const after = applyEdit(draft(), {
    title: 'judul',
    url: 'halaman keranjang',
    problem: 'masalah',
    expected: null,
    action: null,
  });
  assert.equal(after.issue.url, null);
});

test('priority only accepts the Todoist scale', () => {
  assert.equal(applyPriority(draft(), 3).issue.priority, 3);
  assert.equal(applyPriority(draft(), 9).issue.priority, 1, 'out of range falls back to normal');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/draft.test.ts`
Expected: FAIL — `Cannot find module '../src/draft.ts'`.

- [ ] **Step 3: Write the implementation**

Buat `src/draft.ts`:

```ts
import { clipTitle, toUrl, type IssueContext, type NormalizedIssue } from './issue.ts';

/**
 * A submission waiting for its reporter to approve it.
 *
 * Everything the Durable Object needs to finish the job without the original
 * request: the interaction credentials are stored because the alarm has no
 * request of its own to read them from.
 */
export interface Draft {
  id: string;
  status: DraftStatus;
  issue: NormalizedIssue;
  context: IssueContext;
  /** Only this user may touch the draft. */
  reporterId: string;
  applicationId: string;
  token: string;
  /** Set once filed, so a late click can still point at the task. */
  taskUrl: string | null;
}

/** `filed` and `cancelled` are both terminal. */
export type DraftStatus = 'pending' | 'filed' | 'cancelled';

/** What the edit modal can carry. Five fields is Discord's ceiling. */
export interface EditFields {
  title: string;
  url: string | null;
  problem: string;
  expected: string | null;
  action: string | null;
}

export type DraftAction = 'ok' | 'edit' | 'rw' | 'pr' | 'x';

const ACTIONS: readonly DraftAction[] = ['ok', 'edit', 'rw', 'pr', 'x'];

/**
 * `d:` for components, `dm:` for the modals they open.
 *
 * Two prefixes rather than one because a modal submit and a button click arrive
 * as different interaction types and must not be confused for each other. A
 * UUID keeps the whole thing near 45 characters, well under Discord's 100.
 */
export function draftCustomId(action: DraftAction, id: string, modal = false): string {
  return `${modal ? 'dm' : 'd'}:${action}:${id}`;
}

export function parseDraftCustomId(
  customId: string | undefined,
): { action: DraftAction; id: string; modal: boolean } | null {
  const parts = customId?.split(':');
  if (!parts || parts.length !== 3) return null;

  const [prefix, action, id] = parts as [string, DraftAction, string];
  if (prefix !== 'd' && prefix !== 'dm') return null;
  if (!ACTIONS.includes(action) || !id) return null;

  return { action, id, modal: prefix === 'dm' };
}

/**
 * Moves a draft to a terminal status, or refuses.
 *
 * The refusal is the whole point: a click and the alarm can arrive at the same
 * draft, and only one of them may produce a Todoist task. Durable Objects run
 * one request at a time per object, so checking here is enough — no lock needed.
 */
export function claim(draft: Draft, status: 'filed' | 'cancelled'): Draft | null {
  return draft.status === 'pending' ? { ...draft, status } : null;
}

/** Overwrites what the modal carried, leaving priority, due and subtasks alone. */
export function applyEdit(draft: Draft, fields: EditFields): Draft {
  return {
    ...draft,
    issue: {
      ...draft.issue,
      title: clipTitle(fields.title),
      // A reporter can type anything into the form; a non-link rendered as a URL
      // is a dead link in the ticket.
      url: toUrl(fields.url),
      problem: fields.problem,
      expected: fields.expected,
      action: fields.action,
    },
  };
}

export function applyPriority(draft: Draft, priority: number): Draft {
  const valid = priority === 2 || priority === 3 || priority === 4 ? priority : 1;
  return { ...draft, issue: { ...draft.issue, priority: valid } };
}

/** Ephemeral messages are private already; this guards a leaked custom_id. */
export function isReporter(draft: Draft, userId: string | undefined): boolean {
  return userId !== undefined && userId === draft.reporterId;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- test/draft.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/draft.ts test/draft.test.ts
git commit -m "feat: bentuk draft issue dan transisi statusnya"
```

---

### Task 3: Kartu draft di Discord

**Files:**
- Create: `src/review.ts`
- Test: `test/review.test.ts`

**Interfaces:**
- Consumes: `Draft`, `draftCustomId` dari `src/draft.ts`; `truncate` dari `src/followup.ts`
- Produces:
  - `reviewMessage(draft: Draft, minutes: number): Record<string, unknown>`
  - `closedMessage(draft: Draft): Record<string, unknown>`
  - `cancelledMessage(draft: Draft): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Buat `test/review.test.ts`. Salin helper `draft()` dari `test/draft.test.ts` (test dibaca berdiri sendiri; duplikasi kecil di test lebih baik daripada helper bersama yang mengikat dua file):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { type Draft } from '../src/draft.ts';
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
    `d:rw:${ID}`,
    `d:x:${ID}`,
    `d:pr:${ID}`,
  ]);
});

test('the card says when it will file itself', () => {
  const message: any = reviewMessage(draft(), 10);
  assert.match(JSON.stringify(message.embeds[0]), /10 menit/);
});

test('the card is ephemeral', () => {
  assert.equal((reviewMessage(draft(), 10) as any).flags, 64);
});

test('the priority dropdown marks the one the model chose', () => {
  const select: any = flat(reviewMessage(draft({
    issue: { ...fromRawInput('x'), priority: 3 },
  }), 10)).find((c: any) => c.type === 3);
  assert.equal(select.options.find((o: any) => o.default).value, '3');
});

test('an un-normalized draft is flagged rather than presented as tidy', () => {
  const message: any = reviewMessage(
    draft({ context: { ...draft().context, normalized: false } }),
    10,
  );
  assert.match(JSON.stringify(message.embeds[0]), /belum dirapikan/i);
});

test('a closed draft offers its task instead of dead buttons', () => {
  const message: any = closedMessage(draft({ status: 'filed', taskUrl: 'https://app.todoist.com/app/task/9' }));
  assert.equal(flat(message).length, 1);
  assert.equal(flat(message)[0].url, 'https://app.todoist.com/app/task/9');
  assert.ok(!JSON.stringify(message).includes(`d:ok:${ID}`), 'buttons must be gone');
});

test('cancelling hands the text back so nothing is lost', () => {
  const message: any = cancelledMessage(draft({ status: 'cancelled' }));
  assert.match(JSON.stringify(message.embeds[0]), /kodepos tidak terisi otomatis/);
  assert.equal(message.components.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/review.test.ts`
Expected: FAIL — `Cannot find module '../src/review.ts'`.

- [ ] **Step 3: Write the implementation**

Buat `src/review.ts`:

```ts
import { InteractionResponseFlags } from 'discord-interactions';
import { draftCustomId, type Draft } from './draft.ts';
import { truncate } from './followup.ts';

const BLUE = 0x3b82f6;
const AMBER = 0xf59e0b;
const GREY = 0x6b7280;

/** Todoist scale, shown the way the Todoist UI labels it. */
const PRIORITIES = [
  { value: '4', label: 'p1 — mendesak' },
  { value: '3', label: 'p2 — tinggi' },
  { value: '2', label: 'p3 — sedang' },
  { value: '1', label: 'p4 — biasa' },
];

/**
 * The draft the reporter approves.
 *
 * Shows everything that would be filed rather than a summary: approving
 * something you were not shown is not review, and the fields the model invents
 * are exactly the ones worth checking.
 */
export function reviewMessage(draft: Draft, minutes: number): Record<string, unknown> {
  const { issue, context } = draft;
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (issue.url) fields.push({ name: 'Halaman', value: issue.url });
  fields.push({ name: 'Deskripsi', value: truncate(issue.problem, 1000) });
  if (issue.expected) fields.push({ name: 'Harapan', value: truncate(issue.expected, 500) });
  if (issue.action) fields.push({ name: 'Langkah', value: truncate(issue.action, 500) });
  if (issue.dueString) fields.push({ name: 'Tenggat', value: issue.dueString, inline: true });
  if (context.attachments.length > 0) {
    fields.push({ name: 'Gambar', value: `${context.attachments.length} file`, inline: true });
  }
  if (issue.subtasks.length > 0) {
    fields.push({ name: 'Sub-task', value: issue.subtasks.map((s) => `• ${s}`).join('\n') });
  }
  if (issue.needsClarification && issue.clarification) {
    fields.push({ name: '❓ Perlu diperjelas', value: truncate(issue.clarification, 500) });
  }

  return {
    embeds: [
      {
        title: context.normalized
          ? `📝 ${truncate(issue.title, 240)}`
          : `⚠️ ${truncate(issue.title, 240)}`,
        description: context.normalized
          ? 'Cek dulu sebelum masuk Todoist.'
          : 'AI tidak sempat merapikan ini — tulisanmu apa adanya. Cek dulu sebelum masuk Todoist.',
        color: context.normalized ? BLUE : AMBER,
        fields,
        footer: { text: `⏱️ Otomatis masuk dalam ${minutes} menit kalau didiamkan` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Approve', custom_id: draftCustomId('ok', draft.id) },
          { type: 2, style: 2, label: 'Edit hasil', custom_id: draftCustomId('edit', draft.id) },
          { type: 2, style: 2, label: 'Tulis ulang', custom_id: draftCustomId('rw', draft.id) },
          { type: 2, style: 4, label: 'Batal', custom_id: draftCustomId('x', draft.id) },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3, // String Select — priority has no room left in the modal.
            custom_id: draftCustomId('pr', draft.id),
            placeholder: 'Prioritas',
            options: PRIORITIES.map((p) => ({
              ...p,
              default: Number(p.value) === draft.issue.priority,
            })),
          },
        ],
      },
    ],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/** Shown when a click lands on a draft that is already finished. */
export function closedMessage(draft: Draft): Record<string, unknown> {
  return {
    embeds: [
      {
        title: draft.status === 'cancelled' ? '🗑️ Draft ini sudah dibatalkan' : '✅ Draft ini sudah masuk',
        description: draft.taskUrl ? 'Task-nya sudah dibuat.' : 'Tidak ada yang bisa dilakukan lagi di sini.',
        color: GREY,
      },
    ],
    components: draft.taskUrl
      ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Buka di Todoist', url: draft.taskUrl }] }]
      : [],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/** Cancelling must not cost the reporter what they wrote. */
export function cancelledMessage(draft: Draft): Record<string, unknown> {
  return {
    embeds: [
      {
        title: '🗑️ Dibatalkan — tidak masuk Todoist',
        description: truncate(
          `Tulisanmu tidak hilang — silakan salin dari sini:\n\n\`\`\`\n${draft.context.rawInput}\n\`\`\``,
          3800,
        ),
        color: GREY,
      },
    ],
    components: [],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- test/review.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review.ts test/review.test.ts
git commit -m "feat: kartu draft review di Discord"
```

---

### Task 4: Pisahkan normalisasi dari penulisan ke Todoist

Refactor murni: perilaku tidak berubah, test lama harus tetap hijau. Ini yang membuat DO bisa mem-file tanpa menormalkan ulang.

**Files:**
- Modify: `src/process.ts` (pecah `processSubmission`)
- Modify: `src/todoist.ts:21-52` (`createTask` menerima label tambahan, tambah `REVIEW_LABEL`)
- Modify: `src/followup.ts:9-22` (terima kredensial, bukan `Interaction`)
- Modify: `src/handler.ts:194-196`
- Test: `test/process.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSubmission(env: Env, context: Omit<IssueContext, 'normalized'>): Promise<{ issue: NormalizedIssue; context: IssueContext }>`
  - `fileIssue(env: Env, issue: NormalizedIssue, context: IssueContext, extraLabels?: string[]): Promise<ProcessResult>`
  - `export const REVIEW_LABEL = 'needs-review'` di `src/todoist.ts`
  - `editOriginal(applicationId: string, token: string, body: Record<string, unknown>): Promise<void>` di `src/followup.ts`

- [ ] **Step 1: Write the failing test**

Tambahkan ke `test/process.test.ts`:

```ts
test('normalizing does not touch Todoist', async () => {
  const outbound = captureFetch();
  try {
    const { issue, context } = await normalizeSubmission(env, baseContext('kodepos kosong terus'));
    assert.ok(issue.title);
    assert.equal(context.normalized, false, 'no provider configured in tests');
    assert.equal(outbound.sent.length, 0, 'must not file anything yet');
  } finally {
    outbound.restore();
  }
});

test('filing applies the extra labels it is given', async () => {
  const outbound = captureFetch();
  try {
    const { issue, context } = await normalizeSubmission(env, baseContext('kodepos kosong terus'));
    await fileIssue(env, issue, context, [REVIEW_LABEL]);
    const labels = outbound.sent.find((r) => r.url.includes('todoist'))!.body.labels;
    assert.ok(labels.includes('needs-review'));
    assert.ok(labels.includes('needs-triage'), 'the un-normalized label still applies');
  } finally {
    outbound.restore();
  }
});
```

Tambahkan helper di file yang sama kalau belum ada:

```ts
function baseContext(rawInput: string) {
  return {
    command: 'issue' as const,
    rawInput,
    author: 'rifa',
    filedBy: null,
    sourceLink: null,
    typedTitle: null,
    pageUrl: null,
    attachments: [],
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/process.test.ts`
Expected: FAIL — `normalizeSubmission` dan `fileIssue` belum ada.

- [ ] **Step 3: Pecah `process.ts`**

Ganti `processSubmission` di `src/process.ts` dengan dua fungsi. `ProcessResult` tidak berubah:

```ts
/**
 * Turns raw input into a structured issue, without writing anything.
 *
 * Split from filing because the reporter reviews the result before it is saved,
 * and because the alarm that files an abandoned draft must not pay for a second
 * normalization.
 *
 * Best-effort by design: with no provider configured, or when the call fails,
 * the text passes through verbatim and `normalized` comes back false.
 */
export async function normalizeSubmission(
  env: Env,
  context: Omit<IssueContext, 'normalized'>,
): Promise<{ issue: NormalizedIssue; context: IssueContext }> {
  const config = configFromEnv(env);
  const normalized = config ? await normalizeIssue(config, context.rawInput) : null;
  const base = normalized ?? fromRawInput(context.rawInput);

  return {
    // What the reporter typed into the form beats what the model read out of the
    // prose, and survives even when no model ran.
    issue: {
      ...base,
      title: context.typedTitle ? clipTitle(context.typedTitle) : base.title,
      url: toUrl(context.pageUrl) ?? base.url,
    },
    context: { ...context, normalized: normalized !== null },
  };
}

/**
 * Writes the issue to Todoist.
 *
 * Losing the report is never an acceptable outcome, so a rejected write comes
 * back as an error the caller can show rather than an exception.
 */
export async function fileIssue(
  env: Env,
  issue: NormalizedIssue,
  context: IssueContext,
  extraLabels: string[] = [],
): Promise<ProcessResult> {
  // Uploaded before the task is created: the description decides whether to
  // write a Discord link based on what Todoist already holds. Already in main
  // from the images plan — keep it.
  const images = context.attachments.length
    ? await uploadAttachments(env.TODOIST_API_TOKEN, context.attachments)
    : { uploaded: [], failed: [] };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, context, images.failed, extraLabels);
    const subtasks = issue.subtasks.length
      ? await createSubtasks(env.TODOIST_API_TOKEN, task.id, issue.subtasks)
      : { created: 0, failed: 0 };
    const attached = images.uploaded.length
      ? await attachToTask(env.TODOIST_API_TOKEN, task.id, images.uploaded)
      : 0;

    return {
      issue,
      task,
      error: null,
      normalized: context.normalized,
      subtasksCreated: subtasks.created,
      subtasksFailed: subtasks.failed,
      attachmentsUploaded: attached,
      attachmentsFailed: images.failed.length + (images.uploaded.length - attached),
    };
  } catch (cause) {
    console.error('Todoist create failed', cause);
    return {
      issue,
      task: null,
      error: String(cause),
      normalized: context.normalized,
      subtasksCreated: 0,
      subtasksFailed: 0,
      attachmentsUploaded: 0,
      attachmentsFailed: context.attachments.length,
    };
  }
}
```

**Ini refactor, bukan penulisan ulang.** `fileIssue` adalah `processSubmission`
yang sekarang, dipotong bagian normalisasinya. Seluruh logika upload gambar sudah
ada di sana dari plan gambar — pindahkan apa adanya, jangan diketik ulang dari
nol, dan pastikan `uploadAttachments` serta `attachToTask` tetap ter-import.

Import `clipTitle` dan `toUrl` dari `./issue.ts`.

- [ ] **Step 4: Terima label tambahan di `todoist.ts`**

```ts
/** Applied when the text was not normalized, so unreviewed issues stay findable. */
export const TRIAGE_LABEL = 'needs-triage';

/** Applied when the reporter never approved the draft and the alarm filed it. */
export const REVIEW_LABEL = 'needs-review';
```

Ubah tanda tangan dan badan awal `createTask`:

```ts
export async function createTask(
  token: string,
  issue: NormalizedIssue,
  context: IssueContext,
  /** Images that could not be uploaded, so the description still links them. */
  unattached: DiscordAttachment[] = context.attachments,
  extraLabels: string[] = [],
): Promise<CreatedTask> {
  const command: CommandName = context.command;
  const labels = [...COMMANDS[command].labels, ...extraLabels];
  if (!context.normalized) labels.push(TRIAGE_LABEL);
```

**Catatan:** `unattached` sudah lebih dulu ada di parameter keempat sejak plan
gambar dikerjakan, jadi `extraLabels` masuk sebagai yang kelima. Pemanggilan di
`fileIssue` ikut menyesuaikan: `createTask(token, issue, context, images.failed, extraLabels)`.

- [ ] **Step 5: Lepaskan `followup.ts` dari `Interaction`**

DO tidak punya interaction, hanya kredensial yang disimpan di draft:

```ts
/**
 * Replaces the deferred "thinking..." message with the real answer.
 *
 * Takes credentials rather than an Interaction because the alarm that files an
 * abandoned draft has no request of its own — it reads them back from storage.
 *
 * The interaction token authenticates this call, so no bot token is involved.
 * Valid for 15 minutes after the interaction.
 */
export async function editOriginal(
  applicationId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord follow-up failed ${res.status}: ${await res.text()}`);
  }
}

export async function editOriginalResponse(
  interaction: Interaction,
  body: Record<string, unknown>,
): Promise<void> {
  return editOriginal(interaction.application_id ?? '', interaction.token ?? '', body);
}
```

Di `src/handler.ts`, `createAndReport` sekarang memanggil dua fungsi:

```ts
  const { issue, context: full } = await normalizeSubmission(env, context);
  const result = await fileIssue(env, issue, full);
  await editOriginalResponse(interaction, resultMessage(result, context));
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS semua, termasuk test lama yang tidak disentuh.

- [ ] **Step 7: Commit**

```bash
git add src/process.ts src/todoist.ts src/followup.ts src/handler.ts test/process.test.ts
git commit -m "refactor: pisahkan normalisasi dari penulisan ke Todoist"
```

---

### Task 5: Durable Object penyimpan draft dan alarmnya

**Files:**
- Create: `src/draft-core.ts` (seluruh logikanya, tanpa import Workers)
- Create: `src/draft-object.ts` (pembungkus tipis Durable Object)
- Modify: `src/draft.ts` (tambah `openDraft`, `DraftStub`, `reviewTimeoutMinutes`)
- Modify: `src/env.ts`, `src/index.ts`, `wrangler.toml`
- Test: `test/draft-core.test.ts`, `test/helpers.ts`

**Kenapa dua file:** `cloudflare:workers` tidak bisa di-resolve oleh `node --test`,
jadi kelas yang meng-importnya tidak akan pernah bisa dites di sini. Seluruh
logika tinggal di `draft-core.ts` sebagai kelas biasa yang menerima storage lewat
konstruktor; `draft-object.ts` hanya meneruskan. Ini pola yang sama dengan
`handler.ts` vs `index.ts` yang sudah kamu punya.

**Interfaces:**
- Consumes: `fileIssue`, `REVIEW_LABEL`, `editOriginal`, `resultMessage`, `claim`, `applyEdit`, `applyPriority`
- Produces:
  - `class DraftCore` di `src/draft-core.ts` dengan method `start`, `read`, `edit`, `priority`, `approve`, `cancel`, `fire`
  - `interface DraftStorage` — `get`, `put`, `setAlarm`, `deleteAlarm`
  - `class IssueDraft extends DurableObject<Env>` di `src/draft-object.ts`, meneruskan ke `DraftCore` dan memetakan `alarm()` ke `fire()`
  - `interface DraftStub` di `src/draft.ts` — bentuk yang dipakai handler, supaya handler tidak meng-import runtime Workers
  - `openDraft(env: Env, id: string): DraftStub`
  - `reviewTimeoutMinutes(env: Env): number`

- [ ] **Step 1: Write the failing test**

Buat `test/draft-object.test.ts`. Fake `DurableObjectState` ditaruh di `test/helpers.ts`:

```ts
// test/helpers.ts — tambahkan
export function fakeState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    alarmAt: () => alarm,
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => void store.set(key, value),
      setAlarm: async (at: number) => void (alarm = at),
      deleteAlarm: async () => void (alarm = null),
    },
  };
}
```

```ts
// test/draft-core.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { DraftCore } from '../src/draft-core.ts';
import { fromRawInput } from '../src/issue.ts';
import { captureFetch, env, fakeState } from './helpers.ts';

const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function newDraft() {
  return {
    id: ID,
    status: 'pending' as const,
    issue: fromRawInput('kodepos tidak terisi otomatis'),
    context: {
      command: 'issue' as const,
      rawInput: 'kodepos tidak terisi otomatis',
      author: 'rifa',
      filedBy: null,
      sourceLink: null,
      typedTitle: null,
      pageUrl: null,
      attachments: [],
      normalized: true,
    },
    reporterId: '123',
    applicationId: '1',
    token: 'tok',
    taskUrl: null,
  };
}

function object() {
  const state = fakeState();
  return { state, obj: new DraftCore(state.storage, env) };
}

test('starting a draft arms the alarm', async () => {
  const { state, obj } = object();
  await obj.start(newDraft(), 10 * 60_000);
  assert.ok(state.alarmAt()! > Date.now(), 'alarm must be in the future');
  assert.equal((await obj.read())!.status, 'pending');
});

test('approving files once and disarms the alarm', async () => {
  const outbound = captureFetch();
  try {
    const { state, obj } = object();
    await obj.start(newDraft(), 10 * 60_000);

    const first = await obj.approve();
    assert.notEqual(first, 'closed');
    assert.equal(state.alarmAt(), null, 'a filed draft must not fire later');

    // The second click is the race the whole Durable Object exists to prevent.
    const before = outbound.sent.length;
    assert.equal(await obj.approve(), 'closed');
    assert.equal(outbound.sent.length, before, 'must not file twice');
  } finally {
    outbound.restore();
  }
});

test('the alarm files an abandoned draft with needs-review', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = object();
    await obj.start(newDraft(), 10 * 60_000);
    await obj.fire();

    const filed = outbound.sent.find((r) => r.url.includes('todoist'))!;
    assert.ok(filed.body.labels.includes('needs-review'));
    assert.equal((await obj.read())!.status, 'filed');
    assert.ok(outbound.sent.some((r) => r.url.includes('discord')), 'the draft message must be updated');
  } finally {
    outbound.restore();
  }
});

test('the alarm does nothing to a draft that was already approved', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = object();
    await obj.start(newDraft(), 10 * 60_000);
    await obj.approve();
    const before = outbound.sent.length;
    await obj.fire();
    assert.equal(outbound.sent.length, before);
  } finally {
    outbound.restore();
  }
});

test('cancelling stops the alarm and files nothing', async () => {
  const outbound = captureFetch();
  try {
    const { state, obj } = object();
    await obj.start(newDraft(), 10 * 60_000);
    await obj.cancel();
    assert.equal(state.alarmAt(), null);
    assert.equal(outbound.sent.length, 0);
    assert.equal(await obj.approve(), 'closed');
  } finally {
    outbound.restore();
  }
});

test('editing pushes the deadline back', async () => {
  const { state, obj } = object();
  await obj.start(newDraft(), 10 * 60_000);
  const armed = state.alarmAt()!;
  await new Promise((r) => setTimeout(r, 5));
  const edited = await obj.edit({
    title: 'Kodepos kosong',
    url: null,
    problem: 'kodepos tidak terisi',
    expected: null,
    action: null,
  });
  assert.equal(edited!.issue.title, 'Kodepos kosong');
  assert.ok(state.alarmAt()! > armed, 'someone still working on it deserves the full window');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/draft-core.test.ts`
Expected: FAIL — `Cannot find module '../src/draft-core.ts'`.

- [ ] **Step 3: Tulis Durable Object-nya**

Buat `src/draft-core.ts`:

```ts
import { applyEdit, applyPriority, claim, type Draft, type EditFields } from './draft.ts';
import { editOriginal } from './followup.ts';
import { fileIssue, type ProcessResult } from './process.ts';
import { resultMessage } from './result.ts';
import { reviewMessage } from './review.ts';
import { REVIEW_LABEL } from './todoist.ts';
import type { Env } from './env.ts';

const DRAFT = 'draft';
const WINDOW = 'window';
const ATTEMPTS = 'attempts';

/** Retries for an alarm that could not reach Todoist, then it gives up and logs. */
const MAX_ALARM_ATTEMPTS = 3;
const RETRY_MS = 60_000;

/** The slice of Durable Object storage this needs. Kept narrow so tests can fake it. */
export interface DraftStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/**
 * One submission waiting for its reporter.
 *
 * Durable Objects process one request at a time per object, which is the whole
 * reason a draft lives in one rather than in KV: a click arriving as the alarm
 * fires cannot produce two Todoist tasks, with no locking of our own. This class
 * holds all of that logic and none of the runtime, so it can be tested in Node.
 */
export class DraftCore {
  constructor(private readonly storage: DraftStorage, private readonly env: Env) {}

  async start(draft: Draft, windowMs: number): Promise<void> {
    await this.storage.put(DRAFT, draft);
    await this.storage.put(WINDOW, windowMs);
    await this.storage.setAlarm(Date.now() + windowMs);
  }

  async read(): Promise<Draft | null> {
    return (await this.storage.get<Draft>(DRAFT)) ?? null;
  }

  async edit(fields: EditFields): Promise<Draft | null> {
    return this.mutate((draft) => applyEdit(draft, fields));
  }

  async priority(value: number): Promise<Draft | null> {
    return this.mutate((draft) => applyPriority(draft, value));
  }

  /** Returns 'closed' when the draft was already finished by someone else. */
  async approve(): Promise<ProcessResult | 'closed'> {
    const draft = await this.read();
    if (!draft) return 'closed';

    const claimed = claim(draft, 'filed');
    if (!claimed) return 'closed';

    // Claimed before the write, so a second click bounces off immediately
    // instead of racing the Todoist call.
    await this.storage.put(DRAFT, claimed);
    await this.storage.deleteAlarm();

    const result = await fileIssue(this.env, claimed.issue, claimed.context);
    if (result.task) {
      await this.storage.put(DRAFT, { ...claimed, taskUrl: result.task.url });
    } else {
      // Todoist refused: hand the draft back so the reporter can try again
      // rather than stranding their text behind a terminal status.
      await this.storage.put(DRAFT, draft);
      await this.storage.setAlarm(Date.now() + RETRY_MS);
    }
    return result;
  }

  async cancel(): Promise<Draft | null> {
    const draft = await this.read();
    const claimed = draft ? claim(draft, 'cancelled') : null;
    if (!claimed) return null;

    await this.storage.put(DRAFT, claimed);
    await this.storage.deleteAlarm();
    return claimed;
  }

  /**
   * Nobody approved in time, so the report is filed anyway.
   *
   * Losing what someone wrote because they got distracted is the one outcome
   * this project refuses; the label is how triage finds these later.
   */
  async fire(): Promise<void> {
    const draft = await this.read();
    const claimed = draft ? claim(draft, 'filed') : null;
    if (!draft || !claimed) return;

    const result = await fileIssue(this.env, draft.issue, draft.context, [REVIEW_LABEL]);

    if (!result.task) {
      const attempts = ((await this.storage.get<number>(ATTEMPTS)) ?? 0) + 1;
      await this.storage.put(ATTEMPTS, attempts);
      if (attempts >= MAX_ALARM_ATTEMPTS) {
        console.error(`Draft ${draft.id} could not be filed after ${attempts} attempts`);
        return;
      }
      await this.storage.setAlarm(Date.now() + RETRY_MS);
      return;
    }

    await this.storage.put(DRAFT, { ...claimed, taskUrl: result.task.url });
    // Best effort: past minute 15 the token is dead and there is nothing to edit.
    await editOriginal(draft.applicationId, draft.token, resultMessage(result, draft.context));
  }

  /** Editing means someone is still working, so the window starts over. */
  private async mutate(change: (draft: Draft) => Draft): Promise<Draft | null> {
    const draft = await this.read();
    if (!draft || draft.status !== 'pending') return null;

    const next = change(draft);
    await this.storage.put(DRAFT, next);
    const windowMs = (await this.storage.get<number>(WINDOW)) ?? 10 * 60_000;
    await this.storage.setAlarm(Date.now() + windowMs);
    return next;
  }
}
```

Lalu buat pembungkusnya, `src/draft-object.ts` — satu-satunya file baru yang
menyentuh runtime Workers:

```ts
import { DurableObject } from 'cloudflare:workers';
import { DraftCore } from './draft-core.ts';
import type { Draft, EditFields } from './draft.ts';
import type { ProcessResult } from './process.ts';
import type { Env } from './env.ts';

/**
 * Durable Object shell. Every method forwards; the logic lives in DraftCore so
 * it stays testable from plain Node.
 */
export class IssueDraft extends DurableObject<Env> {
  private get core(): DraftCore {
    return new DraftCore(this.ctx.storage as never, this.env);
  }

  start(draft: Draft, windowMs: number): Promise<void> {
    return this.core.start(draft, windowMs);
  }

  read(): Promise<Draft | null> {
    return this.core.read();
  }

  edit(fields: EditFields): Promise<Draft | null> {
    return this.core.edit(fields);
  }

  priority(value: number): Promise<Draft | null> {
    return this.core.priority(value);
  }

  approve(): Promise<ProcessResult | 'closed'> {
    return this.core.approve();
  }

  cancel(): Promise<Draft | null> {
    return this.core.cancel();
  }

  /** The runtime calls this by name; the logic is DraftCore.fire. */
  alarm(): Promise<void> {
    return this.core.fire();
  }
}
```

- [ ] **Step 4: Sambungkan binding dan konfigurasi**

Tambahkan ke `src/draft.ts`:

Import `ProcessResult` sebagai tipe saja (`import type { ProcessResult } from './process.ts';`) — `process.ts` tidak meng-import `draft.ts`, jadi tidak ada siklus.

```ts
/**
 * What the handler needs from a draft object.
 *
 * Declared structurally so handler.ts stays importable from plain Node tests —
 * the real implementation lives behind a Workers-only import.
 */
export interface DraftStub {
  start(draft: Draft, windowMs: number): Promise<void>;
  read(): Promise<Draft | null>;
  edit(fields: EditFields): Promise<Draft | null>;
  priority(value: number): Promise<Draft | null>;
  approve(): Promise<ProcessResult | 'closed'>;
  cancel(): Promise<Draft | null>;
}

export interface DraftBinding {
  idFromName(name: string): unknown;
  get(id: unknown): DraftStub;
}

export function openDraft(env: { DRAFTS: DraftBinding }, id: string): DraftStub {
  return env.DRAFTS.get(env.DRAFTS.idFromName(id));
}

/** Never past 14: the interaction token dies at 15 minutes. */
export function reviewTimeoutMinutes(env: { REVIEW_TIMEOUT_MINUTES?: string }): number {
  const parsed = Number(env.REVIEW_TIMEOUT_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 14) : 10;
}
```

`src/env.ts`:

```ts
  /** One Durable Object per draft awaiting review. */
  DRAFTS: DraftBinding;
  /** Minutes before an untouched draft files itself. Capped at 14. */
  REVIEW_TIMEOUT_MINUTES?: string;
```

Import `DraftBinding` dari `./draft.ts`.

`src/index.ts` — tambahkan export supaya Workers menemukan kelasnya:

```ts
export { IssueDraft } from './draft-object.ts';
```

`wrangler.toml`:

```toml
[vars]
ALLOWED_GUILD_IDS = "1392070580534251621"
LLM_BASE_URL = ""
LLM_MODEL = ""
# Minutes before an untouched draft files itself. Must stay under 15: the
# Discord interaction token expires then, and the alarm could no longer update
# the draft message.
REVIEW_TIMEOUT_MINUTES = "10"

[[durable_objects.bindings]]
name = "DRAFTS"
class_name = "IssueDraft"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["IssueDraft"]
```

Tambahkan `DRAFTS` ke `env` di `test/helpers.ts` supaya tipenya lengkap:

```ts
  DRAFTS: { idFromName: () => ({}), get: () => { throw new Error('unused'); } } as any,
  REVIEW_TIMEOUT_MINUTES: '10',
```

- [ ] **Step 5: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

Kalau `npm test` gagal dengan `Cannot find package 'cloudflare:workers'`, berarti
`draft-object.ts` ikut ter-import dari jalur test. Telusuri rantai import-nya:
hanya `src/index.ts` yang boleh menyentuh file itu.

- [ ] **Step 6: Commit**

```bash
git add src/draft-core.ts src/draft-object.ts src/draft.ts src/env.ts src/index.ts wrangler.toml test/draft-core.test.ts test/helpers.ts
git commit -m "feat: Durable Object penyimpan draft dengan alarm auto-file"
```

---

### Task 6: Sambungkan handler ke alur review

Task terakhir: setelah ini fiturnya hidup dari ujung ke ujung.

**Files:**
- Modify: `src/handler.ts`
- Modify: `src/interaction.ts` (tambah `userIdOf`, `values` pada payload)
- Modify: `src/discord.ts` (modal edit dan modal tulis ulang)
- Test: `test/draft-flow.test.ts`

**Interfaces:**
- Consumes: `openDraft`, `reviewTimeoutMinutes`, `parseDraftCustomId`, `isReporter`, `reviewMessage`, `closedMessage`, `cancelledMessage`, `normalizeSubmission`, `fileIssue`
- Produces: penanganan `InteractionType.MESSAGE_COMPONENT` dan modal ber-prefix `dm:`

- [ ] **Step 1: Write the failing test**

Buat `test/draft-flow.test.ts`:

```ts
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import { fromRawInput } from '../src/issue.ts';
import { captureFetch, env as baseEnv, signed } from './helpers.ts';

const MESSAGE_COMPONENT = 3;
const RESPONSE_MODAL = 9;
const RESPONSE_UPDATE = 7;
const RESPONSE_DEFERRED_UPDATE = 6;
const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

let outbound: ReturnType<typeof captureFetch>;
before(() => { outbound = captureFetch(); });
beforeEach(() => { outbound.sent.length = 0; });
after(() => outbound.restore());

function stubbed(draft: any, calls: string[] = []) {
  const stub = {
    start: async () => void calls.push('start'),
    read: async () => draft,
    edit: async (f: any) => { calls.push('edit'); return { ...draft, issue: { ...draft.issue, ...f } }; },
    priority: async () => { calls.push('priority'); return draft; },
    approve: async () => { calls.push('approve'); return { task: { url: 'https://app.todoist.com/app/task/9' }, issue: draft.issue, error: null, normalized: true, subtasksCreated: 0, subtasksFailed: 0 }; },
    cancel: async () => { calls.push('cancel'); return { ...draft, status: 'cancelled' }; },
  };
  return { env: { ...baseEnv, DRAFTS: { idFromName: () => ({}), get: () => stub } } as any, calls };
}

const pending = () => ({
  id: ID,
  status: 'pending',
  issue: fromRawInput('kodepos tidak terisi otomatis'),
  context: {
    command: 'issue', rawInput: 'kodepos tidak terisi otomatis', author: 'rifa',
    filedBy: null, sourceLink: null, typedTitle: null, pageUrl: null,
    attachments: [], normalized: true,
  },
  reporterId: '123',
  applicationId: '1',
  token: 'tok',
  taskUrl: null,
});

function click(action: string, extra: Record<string, unknown> = {}) {
  return {
    type: MESSAGE_COMPONENT,
    application_id: '1',
    token: 'tok2',
    guild_id: '1392070580534251621',
    member: { user: { id: '123', username: 'rifa' } },
    data: { custom_id: `d:${action}:${ID}`, ...extra },
  };
}

async function call(payload: unknown, env: any) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), env, (p) => deferred.push(p));
  return { body: (await res.json()) as any, deferred };
}

test('Approve acknowledges fast and files in the background', async () => {
  const { env, calls } = stubbed(pending());
  const { body, deferred } = await call(click('ok'), env);
  assert.equal(body.type, RESPONSE_DEFERRED_UPDATE, 'Todoist is too slow for an inline reply');
  await Promise.all(deferred);
  assert.ok(calls.includes('approve'));
});

test('Edit opens a modal prefilled from the draft', async () => {
  const { env } = stubbed(pending());
  const { body } = await call(click('edit'), env);
  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, `dm:edit:${ID}`);
  const ids = body.data.components.map((c: any) => c.component.custom_id);
  assert.deepEqual(ids, ['title', 'page_url', 'raw_input', 'expected', 'action']);
});

test('Tulis ulang opens a modal holding the original text', async () => {
  const { env } = stubbed(pending());
  const { body } = await call(click('rw'), env);
  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, `dm:rw:${ID}`);
  assert.match(JSON.stringify(body.data.components), /kodepos tidak terisi otomatis/);
});

test('the priority dropdown updates the card in place', async () => {
  const { env, calls } = stubbed(pending());
  const { body } = await call(click('pr', { values: ['3'] }), env);
  assert.equal(body.type, RESPONSE_UPDATE);
  assert.ok(calls.includes('priority'));
});

test('Batal hands the text back and files nothing', async () => {
  const { env, calls } = stubbed(pending());
  const { body } = await call(click('x'), env);
  assert.equal(body.type, RESPONSE_UPDATE);
  assert.ok(calls.includes('cancel'));
  assert.match(JSON.stringify(body.data), /kodepos tidak terisi otomatis/);
});

test('a click on a finished draft offers the task instead of acting', async () => {
  const { env, calls } = stubbed({ ...pending(), status: 'filed', taskUrl: 'https://app.todoist.com/app/task/9' });
  const { body } = await call(click('ok'), env);
  assert.equal(body.type, RESPONSE_UPDATE);
  assert.ok(!calls.includes('approve'), 'a closed draft must not be filed again');
  assert.match(JSON.stringify(body.data), /sudah/);
});

test('someone who is not the reporter is refused', async () => {
  const { env, calls } = stubbed(pending());
  const payload = click('ok');
  payload.member.user.id = '999';
  const { body } = await call(payload, env);
  assert.equal(calls.length, 0);
  assert.match(JSON.stringify(body.data), /bukan draft kamu/i);
});

test('an unknown draft id is refused without crashing', async () => {
  const { env } = stubbed(null);
  const { body } = await call(click('ok'), env);
  assert.match(JSON.stringify(body.data), /tidak ditemukan|sudah/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/draft-flow.test.ts`
Expected: FAIL — `MESSAGE_COMPONENT` masih jatuh ke `Unhandled interaction type`, status 400.

- [ ] **Step 3: Tambah modal edit dan tulis ulang**

Di `src/discord.ts`:

```ts
/** custom_id of the expected-behaviour field in the edit modal. */
export const EXPECTED_ID = 'expected';

/** custom_id of the steps field in the edit modal. */
export const ACTION_ID = 'action';

function label(id: string, text: string, value: string | null, style: number, extra: Record<string, unknown> = {}) {
  return {
    type: MessageComponentTypes.LABEL,
    label: text,
    component: {
      type: MessageComponentTypes.INPUT_TEXT,
      custom_id: id,
      style,
      required: false,
      value: value ?? '',
      ...extra,
    },
  };
}

/**
 * Correcting the model's output directly, without paying for another call.
 *
 * Five fields is Discord's ceiling, and it is exactly spent: priority moved to a
 * dropdown on the card, and the due date is left to Todoist.
 */
export function buildEditModal(draft: Draft) {
  const { issue } = draft;
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: draftCustomId('edit', draft.id, true),
      title: 'Perbaiki issue',
      components: [
        label(TITLE_ID, 'Judul', issue.title, TextStyleTypes.SHORT, { required: true, max_length: 100 }),
        label(PAGE_URL_ID, 'Halaman', issue.url, TextStyleTypes.SHORT, { max_length: 500 }),
        label(RAW_INPUT_ID, 'Deskripsi', issue.problem, TextStyleTypes.PARAGRAPH, { required: true, max_length: 4000 }),
        label(EXPECTED_ID, 'Harapan', issue.expected, TextStyleTypes.PARAGRAPH, { max_length: 1000 }),
        label(ACTION_ID, 'Langkah', issue.action, TextStyleTypes.PARAGRAPH, { max_length: 1000 }),
      ],
    },
  };
}

/** Hands back what the reporter originally wrote, for the model to try again. */
export function buildRewriteModal(draft: Draft) {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: draftCustomId('rw', draft.id, true),
      title: 'Tulis ulang',
      components: [
        label(RAW_INPUT_ID, 'Tulisan aslimu', draft.context.rawInput, TextStyleTypes.PARAGRAPH, {
          required: true,
          min_length: 10,
          max_length: 4000,
        }),
      ],
    },
  };
}
```

Import `draftCustomId` dan tipe `Draft` dari `./draft.ts`.

- [ ] **Step 4: Baca id pengguna dan nilai dropdown**

Di `src/interaction.ts`, tambahkan ke `data` di `interface Interaction`:

```ts
    /** Values chosen in a select menu. */
    values?: string[];
```

Dan helper baru:

```ts
/** Discord user id of whoever triggered the interaction. */
export function userIdOf(interaction: Interaction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}
```

- [ ] **Step 5: Routing di handler**

Di `src/handler.ts`, tambahkan case sebelum `default:`:

```ts
    case InteractionType.MESSAGE_COMPONENT:
      return handleDraftComponent(interaction, env, waitUntil);
```

Di awal `handleModalSubmit`, sebelum pemeriksaan `MODAL_PREFIX`:

```ts
  const draftRef = parseDraftCustomId(interaction.data?.custom_id);
  if (draftRef?.modal) return handleDraftModal(interaction, env, draftRef, waitUntil);
```

Lalu fungsi-fungsi barunya:

```ts
/**
 * Every button and dropdown on a draft card.
 *
 * The draft object is the authority on whether an action is still allowed, so
 * this layer only routes, checks ownership and picks the response type Discord
 * needs for each one.
 */
async function handleDraftComponent(
  interaction: Interaction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<Response> {
  const ref = parseDraftCustomId(interaction.data?.custom_id);
  if (!ref) return json(ephemeral('Tombol tidak dikenal.'));

  const stub = openDraft(env, ref.id);
  const draft = await stub.read();
  if (!draft) return json(update(ephemeralBody('Draft ini tidak ditemukan — mungkin sudah lama sekali.')));
  if (!isReporter(draft, userIdOf(interaction))) {
    return json(ephemeral('Ini bukan draft kamu.'));
  }
  if (draft.status !== 'pending') return json(update(closedMessage(draft)));

  switch (ref.action) {
    case 'ok':
      // Todoist is far too slow for the 3-second budget.
      waitUntil(approveDraft(interaction, stub));
      return json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });

    case 'edit':
      return json(buildEditModal(draft));

    case 'rw':
      return json(buildRewriteModal(draft));

    case 'pr': {
      const chosen = Number(interaction.data?.values?.[0]);
      const next = await stub.priority(chosen);
      return json(update(next ? reviewMessage(next, reviewTimeoutMinutes(env)) : closedMessage(draft)));
    }

    case 'x': {
      const cancelled = await stub.cancel();
      return json(update(cancelled ? cancelledMessage(cancelled) : closedMessage(draft)));
    }
  }
}

async function approveDraft(interaction: Interaction, stub: DraftStub): Promise<void> {
  const result = await stub.approve();
  const draft = await stub.read();
  if (!draft) {
    // Nothing left to describe, but the reporter is still staring at a spinner.
    await editOriginalResponse(interaction, { content: 'Draft ini tidak ditemukan lagi.', components: [] });
    return;
  }
  if (result === 'closed') {
    await editOriginalResponse(interaction, closedMessage(draft));
    return;
  }
  await editOriginalResponse(interaction, resultMessage(result, draft.context));
}

/** The two modals a draft card can open. */
async function handleDraftModal(
  interaction: Interaction,
  env: Env,
  ref: { action: DraftAction; id: string },
  waitUntil: WaitUntil,
): Promise<Response> {
  const stub = openDraft(env, ref.id);
  const draft = await stub.read();
  if (!draft) return json(ephemeral('Draft ini tidak ditemukan.'));
  if (!isReporter(draft, userIdOf(interaction))) return json(ephemeral('Ini bukan draft kamu.'));
  if (draft.status !== 'pending') return json(update(closedMessage(draft)));

  const components = interaction.data?.components;

  if (ref.action === 'edit') {
    const next = await stub.edit({
      title: findValue(components, TITLE_ID)?.trim() || draft.issue.title,
      url: findValue(components, PAGE_URL_ID)?.trim() || null,
      problem: findValue(components, RAW_INPUT_ID)?.trim() || draft.issue.problem,
      expected: findValue(components, EXPECTED_ID)?.trim() || null,
      action: findValue(components, ACTION_ID)?.trim() || null,
    });
    // No provider call, so this is fast enough to answer inline.
    return json(update(next ? reviewMessage(next, reviewTimeoutMinutes(env)) : closedMessage(draft)));
  }

  const rawInput = findValue(components, RAW_INPUT_ID)?.trim() ?? '';
  if (rawInput.length < MIN_ISSUE_LENGTH) {
    return json(ephemeral('Issue-nya terlalu pendek. Tolong tulis sedikit lebih detail.'));
  }

  waitUntil(rewriteDraft(interaction, env, stub, draft, rawInput));
  return json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

/** A second pass through the model, which costs the same 5-15 seconds as the first. */
async function rewriteDraft(
  interaction: Interaction,
  env: Env,
  stub: DraftStub,
  draft: Draft,
  rawInput: string,
): Promise<void> {
  const { issue, context } = await normalizeSubmission(env, { ...draft.context, rawInput });
  const next = await stub.edit({
    title: issue.title,
    url: issue.url,
    problem: issue.problem,
    expected: issue.expected,
    action: issue.action,
  });
  await editOriginalResponse(
    interaction,
    next ? reviewMessage({ ...next, context }, reviewTimeoutMinutes(env)) : closedMessage(draft),
  );
}

/** Replaces the card the button was attached to. */
function update(body: Record<string, unknown>) {
  return { type: InteractionResponseType.UPDATE_MESSAGE, data: body };
}

function ephemeralBody(content: string) {
  return { content, flags: InteractionResponseFlags.EPHEMERAL };
}
```

- [ ] **Step 6: Ganti pembuatan issue jadi pembuatan draft**

Ganti `createAndReport` di `src/handler.ts`:

```ts
/**
 * Normalizes, then parks the result for review instead of filing it.
 *
 * If the draft cannot be stored the submission is filed the old way: a feature
 * meant to raise quality must never be the reason a report disappears.
 */
async function createDraftAndReview(
  interaction: Interaction,
  env: Env,
  command: CommandName,
  rawInput: string,
  overrides?: Partial<Omit<IssueContext, 'normalized' | 'command' | 'rawInput'>>,
): Promise<void> {
  const submitted = {
    command,
    rawInput,
    author: authorOf(interaction),
    filedBy: null,
    sourceLink: sourceLinkOf(interaction),
    // Only the modal has these; the context menu leaves them to the model.
    typedTitle: null,
    pageUrl: null,
    attachments: attachmentsOf(interaction),
    ...overrides,
  };

  const { issue, context } = await normalizeSubmission(env, submitted);

  const draft: Draft = {
    id: crypto.randomUUID(),
    status: 'pending',
    issue,
    context,
    reporterId: userIdOf(interaction) ?? '',
    applicationId: interaction.application_id ?? '',
    token: interaction.token ?? '',
    taskUrl: null,
  };

  try {
    await openDraft(env, draft.id).start(draft, reviewTimeoutMinutes(env) * 60_000);
  } catch (cause) {
    console.error('Draft store unavailable, filing directly', cause);
    const result = await fileIssue(env, issue, context);
    await editOriginalResponse(interaction, resultMessage(result, context));
    return;
  }

  await editOriginalResponse(interaction, reviewMessage(draft, reviewTimeoutMinutes(env)));
}
```

Ganti kedua pemanggil `createAndReport` jadi `createDraftAndReview`.

- [ ] **Step 7: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS semua. Test lama di `submit.test.ts` yang memeriksa task langsung terkirim ke Todoist sekarang **harus diperbarui** — submission tidak lagi mem-file langsung. Ubah assertion-nya jadi memeriksa bahwa `waitUntil` dijadwalkan dan kartu review yang dikirim ke Discord; pindahkan pemeriksaan isi task ke `test/process.test.ts` yang memanggil `fileIssue` langsung.

- [ ] **Step 8: Commit**

```bash
git add src/handler.ts src/interaction.ts src/discord.ts test/draft-flow.test.ts test/submit.test.ts
git commit -m "feat: alur review draft di Discord sebelum issue masuk Todoist"
```

- [ ] **Step 9: Verifikasi manual di Discord**

Test tidak bisa membuktikan Discord menerima bentuk pesannya. Jalankan sungguhan:

```bash
npm run register    # modal berubah bentuk, command harus didaftar ulang
npx wrangler dev
# di terminal lain: cloudflared tunnel --url http://localhost:8787
# daftarkan URL trycloudflare-nya sebagai interactions_endpoint_url
```

Jangan menyimpan file apa pun di `src/` selama menguji: hot reload mengganti isolate dan membunuh `waitUntil` yang sedang jalan, dan balasan akan tersangkut di "thinking..." selamanya.

Periksa satu per satu:

1. `/issue` menampilkan 4 field dengan urutan judul, halaman, deskripsi, gambar
2. Kartu draft muncul dengan 4 tombol dan satu dropdown
3. Dropdown prioritas mengubah kartu tanpa membuka modal
4. "Edit hasil" membuka modal terisi, submit langsung memperbarui kartu
5. "Tulis ulang" memanggil AI lagi dan kartunya berubah
6. "Batal" mengembalikan teks asli, dan tidak ada task baru di Todoist
7. "Approve" membuat task dan kartunya berubah jadi tombol "Buka di Todoist"
8. Biarkan satu draft didiamkan penuh 10 menit — task harus muncul berlabel `needs-review` **dan** kartunya berubah sendiri

Kalau nomor 8 gagal, baca log Worker sungguhan di
`.wrangler/state/v3/observability/miniflare-wobs-trace-store/*.sqlite` sebelum
menebak — bedakan alarm yang tidak menyala dari Todoist yang menolak.

- [ ] **Step 10: Commit perbaikan apa pun dari verifikasi manual**

```bash
git add -A && git commit -m "fix: perbaikan dari verifikasi manual alur review"
```
