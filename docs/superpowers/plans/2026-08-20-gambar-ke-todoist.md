# Gambar Tampil di Todoist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gambar yang dikirim lewat Discord benar-benar tersimpan dan tampil di task Todoist, bukan sekadar link CDN Discord yang mati dalam ~24 jam.

**Architecture:** Byte-nya diambil dari CDN Discord, di-upload ke `POST /api/v1/uploads`, lalu dilampirkan ke task lewat `POST /api/v1/comments`. Upload dilakukan **sebelum** task dibuat, supaya deskripsi task tahu gambar mana yang sudah aman di Todoist dan tidak perlu lagi menulis link Discord yang akan mati. Kegagalan upload tidak pernah melempar — task sudah pasti dibuat, dan gambar yang gagal jatuh kembali jadi link Discord dengan peringatan kedaluwarsa seperti sekarang.

**Tech Stack:** TypeScript, Cloudflare Workers (`fetch`, `FormData`, `File`), Todoist API v1, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-20-review-sebelum-todoist-design.md` (bagian "Fase 2")

## Global Constraints

- Laporan tidak boleh hilang. Gambar gagal itu detail yang hilang, bukan laporan yang hilang — mengikuti disiplin `createSubtasks` yang sudah ada di `src/todoist.ts:64`.
- Batas upload paket gratis/starter Todoist: **5 MB per file**. Discord sudah memberi `size` di payload, jadi yang kelewat besar dilewati **tanpa** diunduh.
- Tidak bergantung pada plan review draft. Bisa dikerjakan sebelum atau sesudahnya.
- Test dijalankan dengan `npm test`, typecheck dengan `npm run typecheck`.

---

### Task 1: Buktikan bentuk API-nya sebelum menulis kode produksi

Dokumentasi Todoist menyebut `attachment` sebagai "object containing file attachment details" tanpa merinci isinya. Menebak di sini sudah pernah mahal — `taskUrl` dulu salah tebak dan baru ketahuan setelah link-nya 404. Task ini menghasilkan **jawaban**, bukan kode yang disimpan.

**Files:**
- Create (buang setelahnya): `scripts/probe-upload.ts`

- [ ] **Step 1: Tulis probe**

```ts
// scripts/probe-upload.ts — throwaway. Hapus setelah bentuknya tercatat.
import { readFileSync } from 'node:fs';

const token = process.env.TODOIST_API_TOKEN!;
const API = 'https://api.todoist.com/api/v1';

const bytes = readFileSync(process.argv[2]!);
const form = new FormData();
form.append('file', new File([bytes], 'probe.png', { type: 'image/png' }));

const up = await fetch(`${API}/uploads`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const uploaded = await up.json();
console.log('UPLOAD', up.status, JSON.stringify(uploaded, null, 2));

const task = await fetch(`${API}/tasks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'probe attachment — hapus saya' }),
});
const { id } = await task.json() as { id: string };

const comment = await fetch(`${API}/comments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ task_id: id, attachment: uploaded }),
});
console.log('COMMENT', comment.status, await comment.text());
console.log('Buka task', id, 'dan lihat apakah gambarnya tampil.');
```

- [ ] **Step 2: Jalankan**

```bash
export $(grep TODOIST_API_TOKEN .dev.vars | xargs)
npx tsx scripts/probe-upload.ts /path/ke/screenshot.png
```

- [ ] **Step 3: Catat tiga hal**

1. Field apa saja yang dikembalikan `/uploads`, dan apakah `upload_state` harus `completed` sebelum dipakai
2. Apakah `/comments` menerima `attachment` mentah dari respons upload, atau menuntut `content` ikut dikirim
3. Apakah gambarnya **benar-benar tampil** di task, bukan cuma jadi tautan

Kalau nomor 2 menuntut `content`, pakai nama filenya. Kalau `/comments` menolak bentuknya, coba `{ resource_type: 'file', file_url, file_name, file_type, file_size }`.

- [ ] **Step 4: Bereskan**

```bash
rm scripts/probe-upload.ts
# hapus juga task "probe attachment" dari Todoist
```

Tulis temuannya sebagai komentar di bagian atas `src/todoist.ts` pada task berikutnya — persis seperti komentar "Verified against the API on 2026-08-18" yang sudah ada di sana.

---

### Task 2: Upload gambar ke Todoist

**Files:**
- Modify: `src/todoist.ts`
- Test: `test/attachments.test.ts`

**Interfaces:**
- Consumes: `DiscordAttachment` dari `src/interaction.ts`
- Produces:
  - `interface UploadedFile { file_url: string; file_name: string; file_type: string; file_size: number }`
  - `interface UploadOutcome { uploaded: UploadedFile[]; failed: DiscordAttachment[] }`
  - `export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024`
  - `uploadAttachments(token: string, attachments: DiscordAttachment[]): Promise<UploadOutcome>`
  - `attachToTask(token: string, taskId: string, files: UploadedFile[]): Promise<number>`

- [ ] **Step 1: Write the failing test**

Buat `test/attachments.test.ts`:

```ts
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

const uploadedBody = {
  file_url: 'https://files.todoist.com/abc/shot.png',
  file_name: 'shot.png',
  file_type: 'image/png',
  file_size: 1234,
};

test('an image is fetched from Discord and handed to Todoist', async () => {
  const f = stubFetch((url) =>
    url.includes('discord')
      ? new Response(new Uint8Array([1, 2, 3]))
      : new Response(JSON.stringify(uploadedBody), { headers: { 'content-type': 'application/json' } }),
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

test('one bad file does not take the good ones with it', async () => {
  let call = 0;
  const f = stubFetch((url) => {
    if (url.includes('discord')) return new Response(new Uint8Array([1]));
    call++;
    return call === 1
      ? new Response('nope', { status: 500 })
      : new Response(JSON.stringify(uploadedBody), { headers: { 'content-type': 'application/json' } });
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
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  try {
    const attached = await attachToTask('tok', '99', [uploadedBody, uploadedBody]);
    assert.equal(attached, 2);
    assert.equal(bodies[0].task_id, '99');
    assert.deepEqual(bodies[0].attachment, uploadedBody);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/attachments.test.ts`
Expected: FAIL — `uploadAttachments` belum di-export.

- [ ] **Step 3: Write the implementation**

Tambahkan ke `src/todoist.ts`:

```ts
/**
 * Todoist's own copy of an uploaded file.
 *
 * Passed straight back into the comments API as `attachment`; the field names
 * are Todoist's, so they stay snake_case rather than being renamed.
 */
export interface UploadedFile {
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
}

export interface UploadOutcome {
  uploaded: UploadedFile[];
  /** Files that stay behind as Discord links, expiry warning and all. */
  failed: DiscordAttachment[];
}

/** Todoist's free and starter plans cap a single upload here. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Copies Discord's attachments into Todoist.
 *
 * Done before the task is created, not after: the description needs to know
 * which images are safely in Todoist, because a Discord CDN link written into a
 * ticket is dead within about 24 hours and there is no point keeping one for an
 * image Todoist already holds.
 *
 * Never throws. Sequential because these are the reporter's own screenshots —
 * rarely more than one or two, and parallel uploads would only add ways to fail.
 */
export async function uploadAttachments(
  token: string,
  attachments: DiscordAttachment[],
): Promise<UploadOutcome> {
  const uploaded: UploadedFile[] = [];
  const failed: DiscordAttachment[] = [];

  for (const attachment of attachments) {
    // Discord already told us the size, so an oversized file costs no download.
    if (attachment.size > MAX_UPLOAD_BYTES) {
      console.error(`Attachment ${attachment.filename} is ${attachment.size} bytes, over the plan limit`);
      failed.push(attachment);
      continue;
    }

    try {
      const source = await fetch(attachment.url);
      if (!source.ok) throw new Error(`Discord CDN ${source.status}`);

      const form = new FormData();
      form.append(
        'file',
        new File([await source.arrayBuffer()], attachment.filename, {
          type: attachment.content_type ?? 'application/octet-stream',
        }),
      );

      // No Content-Type header: fetch must set the multipart boundary itself.
      const res = await fetch(`${API}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Todoist upload ${res.status}: ${await res.text()}`);

      uploaded.push((await res.json()) as UploadedFile);
    } catch (cause) {
      console.error(`Attachment ${attachment.filename} failed`, cause);
      failed.push(attachment);
    }
  }

  return { uploaded, failed };
}

/**
 * Attaches uploaded files to the task, one comment each.
 *
 * Comments are how Todoist renders an image inline; a URL in the description is
 * only ever a link. Returns how many landed — the task already exists, so a
 * refused comment is a missing image, not a lost report.
 */
export async function attachToTask(
  token: string,
  taskId: string,
  files: UploadedFile[],
): Promise<number> {
  let attached = 0;

  for (const file of files) {
    try {
      const res = await fetch(`${API}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_id: taskId, attachment: file }),
      });
      if (res.ok) attached++;
      else console.error(`Todoist comment ${res.status}: ${await res.text()}`);
    } catch (cause) {
      console.error('Todoist comment failed', cause);
    }
  }

  return attached;
}
```

Tambahkan `import type { DiscordAttachment } from './interaction.ts';` di atas.

Kalau Task 1 menemukan `/comments` menuntut `content`, tambahkan `content: file.file_name` ke body dan catat alasannya sebagai komentar.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/attachments.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/todoist.ts test/attachments.test.ts
git commit -m "feat: upload gambar Discord ke Todoist"
```

---

### Task 3: Pakai gambar yang sudah di-upload

**Files:**
- Modify: `src/issue.ts` (`renderDescription` menerima daftar yang gagal)
- Modify: `src/todoist.ts` (`createTask` meneruskannya)
- Modify: `src/process.ts` (`fileIssue` merangkai urutannya, `ProcessResult` bertambah)
- Modify: `src/result.ts` (kartu hasil menyebut gambar)
- Test: `test/issue.test.ts`, `test/process.test.ts`

**Interfaces:**
- Consumes: `uploadAttachments`, `attachToTask`, `UploadOutcome` dari Task 2
- Produces:
  - `renderDescription(issue, context, unattached?: DiscordAttachment[]): string` — default `context.attachments`, jadi pemanggil lama tidak berubah perilakunya
  - `createTask(token, issue, context, extraLabels?, unattached?)`
  - `ProcessResult` bertambah `attachmentsUploaded: number` dan `attachmentsFailed: number`

- [ ] **Step 1: Write the failing test**

Tambahkan ke `test/issue.test.ts` (kalau `baseContext()` belum ada di file itu, salin yang dari `test/process.test.ts` — duplikasi kecil di test lebih baik daripada helper bersama yang mengikat dua file):

```ts
test('images already in Todoist are not repeated as dying Discord links', () => {
  const attachment = {
    id: '1', filename: 'shot.png', size: 10,
    url: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
    proxy_url: 'https://media.discordapp.net/x', content_type: 'image/png',
  };
  const context = { ...baseContext(), attachments: [attachment], normalized: true };

  const all = renderDescription(fromRawInput('kodepos kosong'), context, []);
  assert.ok(!all.includes('cdn.discordapp.com'), 'uploaded images need no link');
  assert.ok(!all.includes('kedaluwarsa'));

  const none = renderDescription(fromRawInput('kodepos kosong'), context, [attachment]);
  assert.ok(none.includes('cdn.discordapp.com'), 'a failed upload must still leave the reporter a link');
  assert.ok(none.includes('kedaluwarsa'));
});
```

Tambahkan ke `test/process.test.ts`:

```ts
test('filing uploads the images first, then attaches them to the task', async () => {
  const order: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    if (url.includes('cdn.discordapp')) { order.push('download'); return new Response(new Uint8Array([1])); }
    if (url.includes('/uploads')) { order.push('upload'); return new Response(JSON.stringify({ file_url: 'u', file_name: 'shot.png', file_type: 'image/png', file_size: 10 }), { headers: { 'content-type': 'application/json' } }); }
    if (url.includes('/tasks')) { order.push('task'); return new Response(JSON.stringify({ id: '42' }), { headers: { 'content-type': 'application/json' } }); }
    if (url.includes('/comments')) { order.push('comment'); return new Response('{}', { headers: { 'content-type': 'application/json' } }); }
    return new Response('{}');
  }) as any;

  try {
    const context = {
      ...baseContext('kodepos kosong terus'),
      attachments: [{ id: '1', filename: 'shot.png', size: 10, url: 'https://cdn.discordapp.com/a/b/shot.png', proxy_url: 'x', content_type: 'image/png' }],
    };
    const { issue, context: full } = await normalizeSubmission(env, context);
    const result = await fileIssue(env, issue, full);

    assert.deepEqual(order, ['download', 'upload', 'task', 'comment'],
      'the description can only skip the Discord link if the upload already happened');
    assert.equal(result.attachmentsUploaded, 1);
    assert.equal(result.attachmentsFailed, 0);
  } finally {
    globalThis.fetch = real;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/issue.test.ts test/process.test.ts`
Expected: FAIL — `renderDescription` belum menerima argumen ketiga, `attachmentsUploaded` belum ada.

- [ ] **Step 3: Sadarkan `renderDescription` soal upload**

Di `src/issue.ts`, ubah tanda tangan dan blok gambar:

```ts
export function renderDescription(
  issue: NormalizedIssue,
  context: IssueContext,
  /** Images that never reached Todoist. Defaults to all of them. */
  unattached: DiscordAttachment[] = context.attachments,
): string {
```

```ts
  // Anything Todoist holds is already shown on the task as a real attachment;
  // repeating it as a Discord link only adds a URL that dies within a day.
  if (unattached.length > 0) {
    const links = unattached.map((a) => `- [${a.filename}](${a.url})`).join('\n');
    blocks.push(`**Gambar**\n${links}\n\n⚠️ Link Discord kedaluwarsa ~24 jam.`);
  }
```

- [ ] **Step 4: Teruskan lewat `createTask`**

```ts
export async function createTask(
  token: string,
  issue: NormalizedIssue,
  context: IssueContext,
  extraLabels: string[] = [],
  unattached: DiscordAttachment[] = context.attachments,
): Promise<CreatedTask> {
```

dan di body-nya: `description: renderDescription(issue, context, unattached),`

- [ ] **Step 5: Rangkai urutannya di `fileIssue`**

Di `src/process.ts`, tambahkan dua field ke `ProcessResult`:

```ts
  /** Images now held by Todoist and shown on the task. */
  attachmentsUploaded: number;
  /** Images that stayed behind as Discord links. */
  attachmentsFailed: number;
```

dan ganti badan `try` di `fileIssue`:

```ts
  // Upload first: the description below decides whether to write a Discord link
  // based on what Todoist already holds.
  const images = context.attachments.length
    ? await uploadAttachments(env.TODOIST_API_TOKEN, context.attachments)
    : { uploaded: [], failed: [] };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, context, extraLabels, images.failed);
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
```

Di cabang `catch`, tambahkan `attachmentsUploaded: 0, attachmentsFailed: context.attachments.length,`.

- [ ] **Step 6: Perbarui kartu hasil**

Di `src/result.ts`, ganti blok lampiran:

```ts
  if (result.attachmentsUploaded > 0) {
    notes.push(`🖼️ ${result.attachmentsUploaded} gambar terlampir`);
  }
  if (result.attachmentsFailed > 0) {
    // The task is already filed, so this is the only place the reporter finds out.
    notes.push(`⚠️ ${result.attachmentsFailed} gambar gagal diunggah (maks 5 MB)`);
  }
```

- [ ] **Step 7: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
git add src/issue.ts src/todoist.ts src/process.ts src/result.ts test/issue.test.ts test/process.test.ts
git commit -m "feat: gambar tampil sebagai lampiran di task Todoist"
```

- [ ] **Step 9: Verifikasi manual**

```bash
npx wrangler dev
# cloudflared tunnel --url http://localhost:8787, daftarkan URL-nya
```

Jangan menyimpan file di `src/` selama menguji — hot reload membunuh `waitUntil` yang sedang berjalan.

1. Kirim `/issue` dengan satu screenshot -> buka task-nya: gambar harus **tampil**, bukan sekadar tautan
2. Deskripsi task tidak boleh lagi memuat `cdn.discordapp.com` maupun peringatan kedaluwarsa
3. Kirim file lebih besar dari 5 MB -> task tetap dibuat, kartu hasil menyebut gambar gagal, deskripsi memuat link Discord
4. Kirim dua gambar sekaligus -> keduanya tampil
5. Jalur klik-kanan pada pesan berisi screenshot -> sama hasilnya
