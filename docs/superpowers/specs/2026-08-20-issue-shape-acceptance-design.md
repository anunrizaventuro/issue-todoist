# Menyusutkan issue jadi judul, halaman, kenapa, dan acceptance

Status: disetujui 2026-08-20

## Masalah

Kartu review di Discord memuat lima tombol dan sembilan blok teks, dan task
Todoist yang dihasilkannya sama padatnya. Keduanya berakar pada satu hal:
`NormalizedIssue` punya sepuluh field, dan setiap lapisan setia merender
semuanya.

Yang sebenarnya dipakai saat triase hanya empat: judul, halaman, kenapa ini
penting, dan daftar hal yang harus benar sebelum issue dianggap selesai.

## Bentuk baru

`NormalizedIssue` menyusut dari sepuluh field jadi lima:

| Field | Tipe | Asal |
|---|---|---|
| `title` | `string` | model, atau judul yang diketik pelapor |
| `url` | `string \| null` | form pelapor, atau ditemukan model di teks |
| `why` | `string \| null` | pelapor, tidak pernah ditulis model |
| `acceptance` | `string[]` | model, hasil pemecahan deskripsi |
| `priority` | `1..4` | model, dikoreksi lewat dropdown |

Dihapus: `problem`, `expected`, `action`, `dueString`, `needsClarification`,
`clarification`. `subtasks` menjadi `acceptance`.

`acceptance` dinamai menurut konsepnya, bukan mekanismenya. Todoist tetap
menuliskannya sebagai child task lewat `createSubtasks` — itu memberi centang
per poin dan progress "2/4" pada task induk.

## Yang tetap ada

Deskripsi task Todoist berisi Halaman, Kenapa penting, gambar, dan kutipan
mentah tulisan pelapor. Kutipan itu dipertahankan dengan sengaja: setelah
`problem` hilang, ia satu-satunya konteks naratif yang tersisa kalau model
salah memecah acceptance. Prinsipnya tidak berubah — laporan tidak boleh
hilang.

Prioritas tetap, karena ia satu-satunya field yang mengatur urutan kerja di
Todoist dan sudah punya dropdown sendiri yang tidak memakan slot modal.

## Kartu review

Tombol menyusut jadi tiga: `Approve`, `Edit`, `Batal`. Dropdown prioritas tetap.

`Edit` sekarang mengedit langsung hasil AI. Dengan hanya empat field yang bisa
dikoreksi, semuanya muat dalam satu modal — batas lima komponen Discord yang
dulu memaksa pemisahan `Edit` / `Detail AI` tidak lagi mengikat.

Modal Edit: `Judul`, `Halaman`, `Kenapa ini penting`, `Acceptance`. Acceptance
diedit sebagai textarea, satu poin per baris; baris kosong diabaikan.

Dihapus seluruhnya: `AiFields`, `applyAiEdit`, `applyRewrite`, `rewriteDraft`,
`buildAiModal`, `buildRewriteModal`, dan aksi `'ai'` serta `'rw'`.

`Tulis ulang` hilang bersama mereka. Konsekuensinya tidak ada lagi pass kedua
ke model; acceptance yang salah dikoreksi tangan lewat Edit. Itu justru yang
diminta — edit yang langsung menyentuh hasil AI, bukan yang menyuruh AI coba
lagi.

## Prompt

Skema menyusut ke lima field, dan arah instruksinya berubah: dari "rapikan
laporan jadi prosa" menjadi "pecah deskripsi jadi kriteria acceptance yang bisa
dicentang". Ini perubahan perilaku model yang paling substansial di sini, dan
satu-satunya bagian yang tidak bisa dibuktikan benar oleh test — hanya oleh
pemakaian.

Batas `MAX_SUBTASKS` (8) berpindah jadi `MAX_ACCEPTANCE`, alasannya sama: tiap
poin adalah satu penulisan Todoist yang dibayar sementara pelapor menunggu.

## Draft lama

`IssueContext` dan `NormalizedIssue` ikut di-serialisasi ke Durable Object.
Draft yang ditulis deploy sebelumnya akan mendeserialisasi tanpa `acceptance`,
dan membawa field-field yang sudah tidak dirender lagi.

Yang tidak dirender diabaikan diam-diam. `acceptance` yang absen dibaca sebagai
daftar kosong, sehingga draft lama tetap masuk Todoist sebagai task tanpa child
— bukan sebagai kegagalan. Tidak ada laporan yang mati di transisi.

## Yang tidak berubah

Modal input `/issue` tetap sama: pelapor tetap mengetik judul, halaman,
deskripsi, kenapa penting, dan gambar. Deskripsi tetap jadi bahan mentah yang
dipecah model — ia hanya tidak lagi ikut dirender sebagai prosa tersendiri.

`ProcessResult` tetap menyebut `subtasksCreated`/`subtasksFailed`: pada lapisan
itu mereka memang subtask Todoist. Hanya teks yang dilihat pelapor yang
berganti jadi "acceptance".
