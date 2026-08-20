# Menyusutkan issue jadi judul, halaman, kenapa, dan daftar pekerjaan

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
| `subtasks` | `string[]` | model, hasil pemecahan deskripsi |
| `priority` | `1..4` | model, dikoreksi lewat dropdown |

Dihapus: `problem`, `expected`, `action`, `dueString`, `needsClarification`,
`clarification`. `subtasks` tetap `subtasks`.

Ini sempat dinamai `acceptance` dan promptnya sempat meminta kriteria selesai.
Itu salah: pelapor menulis permintaan kerja, dan model menerjemahkan "keadaan
akhir" jadi klaim "sudah diperbaiki" — pernyataan palsu, bukan kriteria. Yang
dibutuhkan adalah daftar pekerjaan, jadi nama dan prompt dikembalikan ke sana.

## Yang tetap ada

Deskripsi task Todoist berisi Halaman, Kenapa penting, gambar, dan kutipan
mentah tulisan pelapor. Kutipan itu dipertahankan dengan sengaja: setelah
`problem` hilang, ia satu-satunya konteks naratif yang tersisa kalau model
salah memecah pekerjaannya. Prinsipnya tidak berubah — laporan tidak boleh
hilang.

Prioritas tetap, karena ia satu-satunya field yang mengatur urutan kerja di
Todoist dan sudah punya dropdown sendiri yang tidak memakan slot modal.

## Kartu review

Tombol menyusut jadi tiga: `Approve`, `Edit`, `Batal`. Dropdown prioritas tetap.

`Edit` sekarang mengedit langsung hasil AI. Dengan hanya empat field yang bisa
dikoreksi, semuanya muat dalam satu modal — batas lima komponen Discord yang
dulu memaksa pemisahan `Edit` / `Detail AI` tidak lagi mengikat.

Modal Edit: `Judul`, `Halaman`, `Kenapa ini penting`, `Sub-task`. Daftarnya
diedit sebagai textarea, satu poin per baris; baris kosong diabaikan.

Dihapus seluruhnya: `AiFields`, `applyAiEdit`, `applyRewrite`, `rewriteDraft`,
`buildAiModal`, `buildRewriteModal`, dan aksi `'ai'` serta `'rw'`.

`Tulis ulang` hilang bersama mereka. Konsekuensinya tidak ada lagi pass kedua
ke model; daftar yang salah dikoreksi tangan lewat Edit. Itu justru yang
diminta — edit yang langsung menyentuh hasil AI, bukan yang menyuruh AI coba
lagi.

## Prompt

Skema menyusut ke lima field, dan arah instruksinya berubah: dari "rapikan
laporan jadi prosa" menjadi "pecah deskripsi jadi daftar pekerjaan". Bedanya
dengan prompt lama bukan pada bentuk kalimatnya — keduanya imperatif — melainkan
pada keagresifannya: yang lama hanya memecah bila laporan jelas memuat beberapa
perubahan, yang baru selalu memecah.

Bentuk imperatif ditegakkan secara eksplisit, dengan melarang dua kegagalan yang
benar-benar terjadi: keadaan selesai ("sudah diperbaiki") dan kriteria selesai
("tersedia", "muncul dengan normal").

`MAX_SUBTASKS` (8) tetap. Ditambah `MAX_SUBTASK_LENGTH` (500) — penjaga kita
sendiri, bukan batas Todoist yang terdokumentasi, karena `clipTitle` yang dipakai
semula memotong item kerja di 100 karakter dan membuang bagian yang menyebutkan
apa yang harus dikerjakan.

## Draft lama

`IssueContext` dan `NormalizedIssue` ikut di-serialisasi ke Durable Object.
Draft yang ditulis deploy sebelumnya membawa field-field yang sudah tidak
dirender lagi.

Yang tidak dirender diabaikan diam-diam. Karena `subtasks` mempertahankan nama
dan artinya, draft lama justru bermigrasi utuh: daftar pekerjaannya tetap ditulis
sebagai child task. Sebuah draft tanpa daftar sama sekali dibaca sebagai daftar
kosong, bukan sebagai kegagalan.

## Yang tidak berubah

Modal input `/issue` tetap sama: pelapor tetap mengetik judul, halaman,
deskripsi, kenapa penting, dan gambar. Deskripsi tetap jadi bahan mentah yang
dipecah model — ia hanya tidak lagi ikut dirender sebagai prosa tersendiri.

`ProcessResult` tetap menyebut `subtasksCreated`/`subtasksFailed`, dan teks yang
dilihat pelapor tetap "sub-task" — sama dengan istilah Todoist sendiri.
