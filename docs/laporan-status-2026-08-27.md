# Issue Agent — Laporan Status

*27 Agustus 2026*

## Singkatnya

Bot Discord yang mengubah laporan berantakan jadi task rapi di Todoist.

Masalah yang dibereskan: laporan bug/revisi selama ini nyangkut di chat. Ditulis
buru-buru, ketimbun pesan lain, besoknya nggak ada yang inget. Kalaupun dicatat,
ada yang harus nyalin manual satu-satu ke Todoist.

Sekarang: orang nulis seadanya di Discord, AI yang merapikan, dan task-nya
langsung nongol di project Todoist yang benar — lengkap dengan sub-task,
prioritas, screenshot, dan nama pelapornya.

## Cara pakainya

Ada dua pintu masuk:

**1. Ketik `/issue`** — muncul form: Judul (wajib), Deskripsi, URL halaman,
dan "kenapa ini penting". Cuma judul yang wajib; laporan satu baris tetap sah.

**2. Klik kanan pesan → Apps → "Buat Issue"** — pesan yang sudah terlanjur
ditulis di channel langsung jadi issue, berikut screenshot-nya. Ini jalan
pintas buat yang terbiasa paste gambar ke chat.

Habis itu:

1. AI baca tulisannya, bikin judul yang bisa dibaca sekilas, tebak prioritas,
   dan **pecah jadi daftar pekerjaan**. Satu paragraf panjang tanpa titik koma
   biasanya isinya 5–7 pekerjaan terpisah — itu yang dipecah.
2. Muncul **kartu review** yang cuma kelihatan oleh si pelapor. Isinya persis
   apa yang bakal masuk Todoist. Ada tombol **Approve / Edit / Batal**, plus
   dropdown buat ganti prioritas.
3. Approve → masuk Todoist, dan channel dapat pengumuman "📝 Issue baru dari
   [nama]" dengan tombol langsung ke task-nya.
4. **Didiamkan 10 menit → tetap masuk**, tapi dilabeli `needs-review`. Prinsipnya:
   tulisan orang tidak boleh hilang cuma gara-gara dia keburu ke-distract.

## Yang masuk ke Todoist

- Judul + deskripsi asli pelapor (tidak dibuang, tetap disimpan apa adanya)
- Prioritas p1–p4
- **Sub-task** sebagai child task — jadi bisa dicentang satu-satu
- **Screenshot di-upload ke Todoist**, bukan cuma di-link. Link CDN Discord itu
  mati dalam ~24 jam, jadi kalau cuma dilink, dua hari lagi tiketnya kosong.
- Label otomatis: `discord`, `dari-<username>`, dan `dicatat-<username>` kalau
  yang melaporkan beda orang dengan yang menulis. Jadi di Todoist bisa difilter
  "semua laporan dari si A".

**Routing per channel.** Issue masuk ke project sesuai channel tempat dia
ditulis. Yang sudah dipetakan:

| Channel | Project Todoist |
|---|---|
| VENTURO `#officia` | Officia |
| LOGIKA `#tuai` | Tuai Saham |
| lainnya | project default + label `needs-routing` |

Enaknya: siapa yang boleh melapor ke project mana sudah otomatis ngikut siapa
yang bisa lihat channel-nya. Nggak perlu bikin sistem izin sendiri.

Saat ini aktif di 3 server Discord (whitelist — server lain yang nambahin bot
ini ditolak).

## Kalau ada yang error

Ini bagian yang paling banyak dipikirin. Aturan mainnya satu: **laporan orang
nggak boleh hilang, apa pun yang rusak.**

| Kalau… | Yang terjadi |
|---|---|
| **AI-nya mati / timeout / ngaco** | Laporan tetap masuk Todoist apa adanya, dilabeli `needs-triage`. Pelapor dikasih tahu "tercatat, tapi belum dirapikan AI" — jadi kelihatan bedanya antara AI ngadat vs AI memang belum dipasang. |
| **Todoist nolak** | Task nggak jadi, tapi teksnya dibalikin ke pelapor dalam blok yang bisa langsung di-copy. Sistem juga nyoba ulang tiap 1 menit, maksimal 3x. |
| **Pelapor lupa approve** | Auto-masuk setelah 10 menit, dilabeli `needs-review` biar gampang disapu pas triase. |
| **Approve keteken dua kali** | Nggak bisa jadi dua task. Draft "diklaim" duluan sebelum nulis ke Todoist, klik kedua mental. |
| **Gambar > 5 MB** | Gagal upload (batas plan Todoist), tapi tetap ditulis sebagai link di deskripsi + pelapor diberi tahu. |
| **Sub-task ada yang gagal** | Task induk tetap jadi, pelapor dikasih tahu berapa yang gagal. |
| **Ada yang iseng nembak tombol orang lain** | Ditolak — tombol draft cuma nurut ke pelapornya. |
| **Server Discord asing nambahin bot** | Ditolak di pintu masuk, sebelum apa pun jalan. |

Intinya: nggak ada satu pun jalur error yang ujungnya "tulisan kamu hilang".

## Status teknis

- **Cloudflare Workers + Durable Objects**, TypeScript. Serverless — nggak ada
  server yang harus dijaga, di-patch, atau dibayar bulanan. Pemakaian segini
  masuk free tier.
- **203 unit test, semuanya lulus.** Logikanya sengaja dipisah dari runtime
  Cloudflare supaya bisa dites tanpa nyalain apa pun.
- 33 commit, riwayatnya rapi dan bisa di-rollback per fitur.
- Ganti provider AI = ganti 3 setting, **bukan** ganti kode. Endpoint-nya pakai
  standar OpenAI-compatible, jadi OpenRouter / OpenAI / Groq / model lokal
  semuanya tinggal colok.

## Yang masih kurang — dan ini yang perlu keputusan

**Sekarang AI-nya masih nebeng gateway internal, jalan dari laptop saya.**

Itu cukup buat demo dan uji coba, tapi nggak bisa dipakai produksi. Alasannya
teknis dan nggak bisa diakalin: Worker-nya jalan di edge Cloudflare, sementara
gateway internal ada di alamat privat (`10.10.1.31`) — dari luar jaringan
memang nggak bisa dijangkau. Selama masih begini, botnya cuma hidup selama
laptop saya nyala dan `wrangler dev` jalan.

Ditambah lagi gateway itu sendiri agak rewel: lambat, dan kadang balasannya
nyampur — schema-nya ikut disalin ke jawaban sehingga nggak kebaca. Sudah saya
tambal di kode (retry + pembersih format), tapi tambalan ya tambalan.

**Jadi yang saya butuhkan:**

1. **Satu API key provider LLM cloud** — rekomendasi saya **OpenRouter**, karena
   satu akun bisa akses banyak model dan gampang ganti-ganti kalau mau cari yang
   paling murah/paling pas. Alternatif: OpenAI atau Groq langsung.
2. **Budget kecil untuk pemakaiannya.** Kasar: sekali laporan itu sekitar 2–3
   ribu token. Pakai model kelas *flash* (yang lebih dari cukup untuk pekerjaan
   ini), **100 laporan sebulan estimasinya masih di bawah $1**. Kalau mau pakai
   model kelas atas pun, kisarannya masih beberapa dolar per bulan. Angka ini
   estimasi, bukan tagihan — tapi ordernya segitu, bukan puluhan dolar.
3. **Akun Todoist yang project-nya bisa diakses tim.** Sekarang masih pakai
   token akun saya, jadi tombol "Buka di Todoist" cuma jalan buat yang punya
   akses ke project itu.
4. **Daftar channel → project yang lengkap**, kalau mau dipakai lintas tim.
   Sekarang baru 2 yang dipetakan; sisanya numpuk di project default.

## Kalau disetujui

Langkahnya pendek:

1. Bikin akun + API key provider
2. Pasang key-nya sebagai secret (`wrangler secret put`)
3. `npm run deploy` ke Cloudflare
4. Arahkan endpoint Discord ke URL produksi
5. Tes 1–2 laporan beneran

Realistis **sekitar 1 jam**, sudah termasuk verifikasi. Setelah itu botnya jalan
sendiri 24/7 tanpa tergantung laptop siapa pun.

---

*Ada pertanyaan atau mau lihat demonya langsung, tinggal bilang.*
