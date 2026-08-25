# Dienstplan

Sistem penjadwalan & absensi staf (check-in/out, approval, komplain, Freiwunsch/Urlaub,
penghitung jam kerja) — gratis, multi-tenant, dibuat semirip mungkin secara visual dengan
Hotel PMS supaya suatu saat bisa "dicangkokkan" jadi modul di dalam Hotel PMS.

Repo ini **berdiri sendiri** dulu (Supabase project sendiri, stack sendiri), karena tujuan
awalnya cuma untuk satu resto (tempat kerja pacarmu). Tapi strukturnya sudah multi-tenant
dari hari pertama, jadi kalau ada resto/bisnis kedua yang mau pakai, tinggal `insert` satu
baris ke tabel `organizations` — tidak perlu deploy ulang.

## Kenapa "Organizations", bukan "Restaurants"

Aku pilih **`organizations`** (bukan `restaurants` / `businesses`). Alasannya:

- Restoran pacarmu itu tenant pertama, bukan satu-satunya use case. Kalau ada yang mau pakai
  ini untuk toko retail, klinik, bengkel, dst — kata "restaurant" di skema/kode akan
  menyesatkan.
- "Business" agak ambigu di konteks hotel (Hotel PMS sendiri adalah sebuah bisnis; kalau
  Dienstplan jadi modul DI DALAM Hotel PMS, "organization" tetap masuk akal sebagai
  "hotel ini juga satu organization", sedangkan "business" akan terasa aneh dipakai untuk
  merujuk hotelnya sendiri).
- "Organization" adalah istilah standar di banyak produk SaaS multi-tenant (Slack, Notion,
  Vercel, dll) — jadi kalau nanti butuh fitur seperti "invite member", "billing per org",
  "org settings", polanya sudah familiar.

## Struktur proyek

```
dienstplan/
├── sql/
│   └── schema.sql              # jalankan ini di SQL Editor Supabase project BARU
├── src/                        # source TypeScript
│   ├── types.ts                # tipe data, 1:1 dengan tabel di schema.sql
│   ├── supabaseClient.ts       # koneksi ke Supabase project Dienstplan (BUKAN project Hotel PMS)
│   ├── auth.ts                 # login, resolve organization + membership/role
│   ├── shiftAvailability.ts    # deteksi bentrok jadwal (analog roomAvailability.js)
│   ├── hoursCalculator.ts      # Soll / Ist / Überstunden
│   ├── leaveRequests.ts        # Freiwunsch & Urlaub
│   ├── complaints.ts           # komplain karyawan + upload bukti
│   ├── dienstplan.ts           # file utama — rack/timeline, check-in/out, drag & drop
│   └── panels.ts               # modal & panel glue (approvals, complaints, leave requests)
├── css/
│   ├── style.css                # base — disalin 1:1 dari css/style.css Hotel PMS
│   └── dienstplan.css           # adaptasi css/roomRack.css Hotel PMS
├── index.html
├── tsconfig.json
└── package.json
```

## Setup

1. **Buat Supabase project baru** (terpisah dari project Hotel PMS — data gaji, komplain,
   dan bukti komplain sengaja tidak dicampur dengan data tamu/reservasi hotel).
2. Jalankan `sql/schema.sql` di SQL Editor project baru itu.
3. Buat Storage bucket `complaint-evidence` (private) — ada contoh perintahnya di komentar
   paling bawah `schema.sql`.
4. Isi `src/supabaseClient.ts` dengan URL + anon key project barumu.
5. `npm install && npm run build` — meng-compile `src/*.ts` ke `dist/*.js` (sudah dicek,
   compile bersih tanpa error).
6. Deploy foldernya sebagai static site (Vercel/Netlify/GitHub Pages semua bisa — tidak ada
   backend selain Supabase).
7. Buat organization pertama:
   ```sql
   insert into organizations (name, slug) values ('Restoran Pacarku', 'resto1');
   ```
8. Buat user via Supabase Auth (dashboard atau `supabase.auth.signUp`), lalu masukkan ke
   `memberships` dengan role `owner` untuk pemilik resto, `manager` untuk kepala/bos,
   `employee` untuk staf biasa.
9. Akses `https://domainmu.com/index.html?org=resto1`.

### Nambah organization kedua (resto lain / bisnis lain)

```sql
insert into organizations (name, slug) values ('Resto Kedua', 'resto2');
```
Lalu akses `?org=resto2` — deployment yang sama, data 100% terpisah lewat RLS
(`is_org_member` / `is_org_manager` di schema.sql memastikan user hanya bisa lihat data
organization tempat dia punya membership aktif).

## Fitur yang sudah diimplementasikan

| Fitur | Keterangan |
|---|---|
| **Check-in / Check-out** | Selalu masuk sebagai `time_entries` berstatus `pending`. Tidak pernah langsung "approved", termasuk kalau yang klik itu manager sekalipun — supaya jejak audit tetap bersih. |
| **Notes lupa checkin/out** | Field `employee_note` di modal check-in/out. Kalau checkout tanpa ada entry checkin yang masih terbuka, sistem tetap terima sebagai request baru dengan catatan otomatis "No matching check-in found". |
| **Approval oleh bos** | Panel "Approvals" (`manager-required`) — approve langsung, atau "Edit" untuk set jam manual (`managerSetTimeEntry`), atau reject. |
| **Komplain/protes karyawan** | Setelah entry di-approve/di-edit manager, karyawan bisa buka `complaintModal` dari catatan itu, isi alasan + upload bukti (foto/PDF) ke Storage. Manager resolve lewat panel "Complaints". `original_clock_in/out` di `time_entries` disimpan supaya bisa dibandingkan dengan versi yang di-approve. |
| **Freiwunsch & Urlaub** | `leaveRequests.ts` — submit, lalu manager approve/reject di panel "Leave Requests". Ditampilkan juga sebagai chip putus-putus di rack (`.plan-leave-chip`). |
| **Soll/Ist/Überstunden** | `hoursCalculator.ts`, panel "Hours" — dihitung dari `time_entries` yang **approved** saja, per minggu berjalan (gampang diubah ke bulanan). |
| **Tampilan rack responsif** | HP (≤700px): 3 hari (kemarin/hari ini/besok) dengan tombol ◀▶. Tablet: 7 hari. Layar lebar: sampai 30 hari (bulanan). Diatur di `getPlanDayCount()`, sama polanya dengan `getRackDayCount()` di `roomRack.js`. |
| **AM/PM dihapus, tapi bisa dinyalakan lagi** | Bar shift sekarang berbasis jam sungguhan (`start_time`/`end_time`), bukan slot AM/PM. Nachtdienst ditangani otomatis kalau `end_time` lebih kecil dari `start_time` (dianggap lewat tengah malam) — lihat `getShiftRange()` di `shiftAvailability.ts`. Toggle `settings.half_day_mode` di tabel `organizations` sudah disediakan di `types.ts` untuk siapa pun yang nanti benar-benar butuh split AM/PM, tinggal diimplementasikan di rendering kalau diperlukan. |
| **Drag & drop shift** | Manager drag = langsung update `shifts` (setelah cek bentrok via `findShiftConflicts`). Karyawan drag = insert ke `shift_change_requests`, shift aslinya tidak berubah sampai manager approve dari panel "Approvals". |

## Rencana integrasi ke Hotel PMS

Karena ini sudah TypeScript + Supabase (bukan campur JS biasa), integrasinya nanti tinggal:

1. Compile `src/*.ts` → `dist/*.js` seperti sekarang, taruh di folder `js/dienstplan/` di
   dalam repo Hotel PMS.
2. Hotel PMS load dua `supabaseClient` sekaligus — satu punya sekarang (`js/supabase.js`,
   project Hotel PMS), satu lagi `dist/supabaseClient.js` (project Dienstplan). Dua project
   Supabase yang berbeda bisa hidup berdampingan di satu halaman tanpa konflik.
3. Tambah 1 tab baru di navigasi Hotel PMS (`js/navigation.js`) yang mengarah ke
   `index.html`, styling-nya otomatis nyambung karena sudah pakai kelas yang sama
   (`.rack-page`, `.reservation-bar`, `.rack-row`, dst).
4. Hotel (sebagai bisnis) tinggal jadi satu baris di `organizations` juga — jadi Hotel PMS
   dan restoran pacarmu bisa 100% terpisah datanya walau bentuk modulnya identik.

## Yang belum dibuat (di luar scope pesan ini, tapi gampang ditambah)

- Halaman Settings UI untuk toggle `night_shift_enabled` / `half_day_mode` per organization
  (kolomnya sudah ada di `organizations.settings`, tinggal bikin form-nya).
- Export jadwal/jam kerja ke PDF/Excel.
- Notifikasi (email/push) saat ada yang butuh approval.
- Shift template/copy-minggu-lalu untuk mempercepat bos bikin jadwal.
