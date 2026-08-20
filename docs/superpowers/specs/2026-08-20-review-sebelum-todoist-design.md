# Review di Discord sebelum issue masuk Todoist

Status: disetujui, siap dibuatkan rencana implementasi
Tanggal: 2026-08-20

## Masalah

Hari ini submission langsung jadi task Todoist. Apa pun yang dihasilkan AI —
judul meleset, prioritas ketinggian, sub-task yang tidak diminta — mendarat di
backlog tanpa ada yang sempat melihatnya. Pelapor baru sadar setelah task-nya
ada, dan memperbaikinya berarti pindah aplikasi.

Ditambah satu keluhan bentuk: form-nya satu textarea bebas, padahal yang
sebenarnya dibutuhkan tim adalah judul, halaman, alasan, dan gambar.

## Yang dibangun

Satu tahap review di antara submit dan Todoist. Pelapor melihat draft issue
sebagai pesan ephemeral berisi tombol, lalu approve, mengoreksi, meminta AI
menulis ulang, atau membatalkan. Draft yang didiamkan 10 menit **tetap masuk**
Todoist dengan label `needs-review`.

Sekaligus: form input diubah jadi 4 field terstruktur, dan gambar benar-benar
di-upload ke Todoist alih-alih ditempel sebagai link CDN Discord yang mati
dalam 24 jam.

## Keputusan dan alasannya

| Keputusan | Alasan |
|---|---|
| Yang mereview = pelapor sendiri, pesan ephemeral | Tidak menyentuh soal izin sama sekali. Triase bersama bisa ditambahkan belakangan tanpa membongkar ini. |
| Draft terbengkalai tetap di-file otomatis | Prinsip inti project ini adalah "laporan tidak boleh hilang". Review adalah gerbang kualitas, bukan lubang tempat laporan menguap. |
| Timeout 10 menit, bukan 30 | Token interaction Discord mati di menit ke-15. Di menit 10 alarm masih bisa **menyunting pesan draft itu sendiri** jadi "otomatis dimasukkan". Di menit 30 tidak bisa, dan pelapor akan menatap tombol Approve yang sudah basi. |
| Durable Object per draft, bukan KV/D1 + cron | DO dieksekusi berurutan per objek, jadi "approve di detik 599" dan "alarm di detik 600" mustahil menghasilkan dua task. Timer per-draft tanpa sweeper. KV *eventually consistent* — double-file adalah bug nyata di sana. Cron juga tidak jalan sendiri di `wrangler dev`, padahal itulah jalur yang melayani produksi hari ini. |
| Ada tombol Batal | Begitu auto-file dipilih, salah kirim **pasti** mendarat di Todoist 10 menit kemudian. Tanpa Batal tidak ada cara menghentikannya. |
| Prioritas lewat dropdown di kartu, bukan modal | Modal Discord dibatasi 5 field dan sudah habis. Prioritas adalah field yang paling sering ditebak salah AI, dan satu dropdown = satu klik. |
| AI tidak dipangkas; kartu review menampilkan semuanya | Kalau kartu menampilkan lebih sedikit daripada yang dikirim, pelapor meng-approve sesuatu yang tidak dia lihat — dan review kehilangan gunanya. |
| Judul & URL yang diketik menang atas AI | Pola yang sudah ada untuk `pageUrl` di `process.ts`. Skema AI tetap menghasilkan `title` karena jalur klik-kanan tidak punya modal. |

## Alur

### State machine

Satu draft = satu Durable Object. Status: `pending` -> `filed` | `cancelled`.
Keduanya terminal. Setiap transisi mengklaim status di dalam DO, jadi dua jalur
yang berlomba (klik pengguna vs alarm) tidak pernah dua-duanya menang.

### Submit

1. Modal submit / klik-kanan -> validasi panjang -> DEFER ephemeral. *(tidak berubah)*
2. Di `waitUntil`: `normalizeSubmission()` -> buat draft di DO -> `setAlarm(+10 menit)`
3. Sunting pesan "thinking..." jadi kartu draft

### Kartu draft (ephemeral)

Menampilkan seluruh isi yang akan dikirim: Judul, Halaman, Deskripsi (masalah,
harapan, langkah), Gambar, prioritas, tenggat, sub-task, dan pertanyaan
klarifikasi bila AI mengajukannya. Ditutup baris "otomatis masuk dalam 10 menit
kalau didiamkan".

Baris 1: `[ Approve ] [ Edit hasil ] [ Tulis ulang ] [ Batal ]`
Baris 2: dropdown prioritas p1-p4.

### Interaksi

| custom_id | Respon Discord | Kerja |
|---|---|---|
| `d:ok:<id>` | DEFERRED_UPDATE (6) | klaim `filed` -> `fileIssue()` -> tulis ulang pesan dengan `resultMessage()` |
| `d:edit:<id>` | MODAL | prefill 5 field: Judul, Halaman/URL, Deskripsi, Harapan, Langkah |
| `dm:edit:<id>` | UPDATE_MESSAGE (7) | timpa field, reset alarm, render ulang kartu. AI tidak jalan, jadi instan |
| `d:rw:<id>` | MODAL | prefill teks asli |
| `dm:rw:<id>` | DEFERRED_UPDATE (6) | normalisasi ulang (5-15 dtk), reset alarm, render ulang kartu |
| `d:pr:<id>` | UPDATE_MESSAGE (7) | set prioritas, reset alarm, render ulang kartu |
| `d:x:<id>` | UPDATE_MESSAGE (7) | klaim `cancelled`, hapus alarm, balas berisi teks asli supaya masih bisa disalin |

`<id>` adalah UUID. Total ~45 karakter, jauh di bawah batas 100 Discord.

### Alarm

Kalau status masih `pending`: `fileIssue()` dengan label tambahan
`needs-review`, lalu sunting pesan draft jadi hasil akhir memakai
`application_id` + `token` yang disimpan saat draft dibuat.

## Perubahan per file

### Baru

- **`src/draft.ts`** — bentuk draft, `openDraft(env, id)`, parsing `custom_id`,
  dan transisi status sebagai fungsi murni. Tidak meng-import `cloudflare:workers`
  supaya tetap bisa dites di Node.
- **`src/draft-object.ts`** — kelas Durable Object `IssueDraft` dan `alarm()`.
  Satu-satunya file baru yang menyentuh runtime Workers, dan hanya di-import
  `index.ts` — menjaga disiplin yang sudah ada bahwa `index.ts` adalah satu-satunya
  file Workers-specific.
- **`src/review.ts`** — perakit kartu draft. Tetangga `result.ts`, bukan campuran
  ke dalamnya: yang satu merender draft, yang satu merender hasil akhir.

### Diubah

- **`src/discord.ts`** — modal jadi 4 field: Judul (short, wajib, min 5, maks 100 —
  batas `clipTitle`), Halaman/URL (short, opsional, maks 500), Deskripsi (paragraph,
  wajib, min 10, maks 4000), Gambar (file upload, maks 4). Tambah `TITLE_ID`.
  Tambah perakit modal edit dan modal tulis-ulang.
- **`src/issue.ts`** — `IssueContext` dapat `typedTitle: string | null`, kembar
  dengan `pageUrl`.
- **`src/process.ts`** — dipecah jadi `normalizeSubmission()` (dipanggil handler
  sebelum draft dibuat) dan `fileIssue()` (dipanggil DO saat approve atau alarm).
  Override judul diterapkan di tempat yang sama dengan override URL.
- **`src/handler.ts`** — tangani `MESSAGE_COMPONENT` dan `MODAL_SUBMIT` ber-prefix
  draft. `createAndReport` jadi `createDraftAndReview`.
- **`src/todoist.ts`** — `createTask` menerima label tambahan; const `REVIEW_LABEL =
  'needs-review'` bersebelahan dengan `TRIAGE_LABEL` yang sudah ada; fungsi upload
  gambar (fase 2).
- **`src/env.ts`** — binding `DRAFTS`, var `REVIEW_TIMEOUT_MINUTES`.
- **`src/index.ts`** — export kelas DO.
- **`wrangler.toml`** — binding `durable_objects` + migration `new_sqlite_classes`,
  var `REVIEW_TIMEOUT_MINUTES = "10"`.

## Fase 2: gambar tampil di Todoist

Berdiri sendiri — tidak menyentuh Durable Object maupun alur review, jadi bisa
dikerjakan sebelum atau sesudahnya.

Sekarang gambar hanya ditempel sebagai link CDN Discord di deskripsi, dan link
itu mati dalam ~24 jam: task lama pasti kehilangan gambarnya. Gantinya: ambil
byte dari CDN Discord -> upload ke Todoist -> lampirkan ke task lewat comment.

- Tidak pernah melempar, sama seperti `createSubtasks`: task sudah tersimpan,
  gambar gagal itu detail hilang, bukan laporan hilang.
- Lebih dari 5 MB (batas paket gratis Todoist) dilewati dengan peringatan di
  kartu hasil.
- Kalau upload sukses, link Discord **tidak** lagi ditulis di deskripsi — link
  yang mati dalam 24 jam hanya jadi sampah.

## Kegagalan

| Kejadian | Perilaku |
|---|---|
| AI gagal / tidak dikonfigurasi | Draft tetap dibuat dari `fromRawInput`, kartu ditandai "belum dirapikan AI", tetap bisa diedit. Justru di sini review paling berguna. |
| Membuat DO gagal | Jatuh balik ke alur lama: langsung `fileIssue()`. Laporan tidak boleh hilang gara-gara fitur yang tujuannya menjaga kualitas. |
| Klik tombol di draft yang sudah terminal | "Draft ini sudah ditutup" + link task bila ada. |
| Yang klik bukan pelapornya | Ditolak. `reporterId` disimpan di draft. |
| Alarm gagal menulis ke Todoist | Coba lagi 1 menit kemudian, maksimal 3 kali, lalu menyerah dan mencatat log. |
| Todoist menolak saat approve | Kartu gagal yang sudah ada dipakai apa adanya; teks asli dikembalikan ke pelapor. |

## Test

Gaya yang sudah ada: `node:test`, tanpa framework tambahan.

- `draft.test.ts` — state machine: approve setelah cancel ditolak, alarm setelah
  approve jadi no-op, edit me-reset alarm, klik oleh bukan pelapor ditolak.
- `review.test.ts` — render kartu (termasuk varian "belum dirapikan AI"), parse
  `custom_id`.
- `submit.test.ts` — tambahan: modal 4 field, judul yang diketik menang atas AI.
- `todoist.test.ts` — upload gambar, lewati yang lebih dari 5 MB, gagal upload
  tidak melempar.
- `test/helpers.ts` — fake `DurableObjectState` (storage + setAlarm) dan fake stub.

## Sengaja tidak dikerjakan

- Triase publik / approve oleh orang lain. Pilihan sadar; bisa ditambahkan di
  atas ini tanpa membongkar apa pun.
- Mengedit sub-task, gambar, atau teks klarifikasi dari kartu review.
- Mengedit **tenggat** dari kartu review. Slot modal habis di lima (Judul, URL,
  Deskripsi, Harapan, Langkah) dan tenggat jarang terisi — AI hanya mengisinya
  bila pelapor menyebut. Kalau salah: "Tulis ulang", atau perbaiki di Todoist.
  Prioritas tidak kena batas ini karena dipindah ke dropdown di kartu.
- Riwayat draft, statistik "berapa yang diedit", atau audit trail.
- Mengubah task Todoist yang sudah dibuat.

## Perlu diverifikasi saat implementasi

Hal-hal yang saya rancang tapi belum dibuktikan di lingkungan ini:

1. **Durable Object dengan storage SQLite tersedia di paket akun ini.** Kalau
   ternyata tidak, alternatifnya D1 + Cron Trigger (opsi C yang dibahas dan
   ditolak) — keputusannya perlu diambil ulang, bukan ditambal.
2. **Endpoint upload Todoist v1** (`/uploads`) dan bentuk `attachment` pada
   `/comments`. Dokumentasi dicek dulu; jangan menebak seperti `taskUrl` dulu
   pernah salah tebak.
3. **UPDATE_MESSAGE (7) sebagai balasan modal yang dibuka dari komponen** pesan
   ephemeral. Kalau Discord menolak, jatuh ke DEFERRED_UPDATE (6) + PATCH.
4. **Alarm DO bertahan di `wrangler dev`** melewati hot reload. Catatan lama:
   hot reload membunuh `ctx.waitUntil` yang sedang jalan — alarm mestinya justru
   selamat karena tersimpan di storage, tapi ini harus dilihat sendiri.
