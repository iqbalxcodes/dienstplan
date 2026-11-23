// Languages: de / en / id.
// Code uses the ENGLISH text as the key: tr("Save"). en needs no entry (the key is the text),
// except German-source keys and the dotted keys. Missing de/id entry = English text.
// Placeholders: tr("{n} Days", { n: 3 }).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "de" | "en" | "id";
type Dict = Record<string, string>;

// [key, de, id]  ("" = same as the key)
const ROWS: [string, string, string][] = [
    // ---- navigation / login / settings (dotted keys) ----
    ["hours.freiwunsch", "Freiwunsch", "Permintaan Libur"], ["hours.urlaub", "Urlaub", "Cuti"],
    ["nav.dashboard", "Übersicht", "Dasbor"], ["nav.schedule", "Dienstpläne", "Jadwal"], ["nav.hours", "Zeiten", "Waktu"],
    ["nav.manager", "Manager", "Manajer"], ["nav.timesheet", "Zeiterfassung", "Catatan Waktu"],
    ["nav.leave", "Freiwünsche & Urlaub", "Libur & Cuti"], ["nav.admin", "Admin", "Admin"],
    ["nav.history", "Aktivität", "Aktivitas"], ["nav.settings", "Einstellungen", "Pengaturan"],
    ["login.title", "Dienstplan Login", "Login Dienstplan"], ["login.email", "E-Mail", "Email"],
    ["login.password", "Passwort", "Kata sandi"], ["login.remember", "Auf diesem Gerät merken", "Ingat saya di perangkat ini"],
    ["login.submit", "Anmelden", "Masuk"],
    ["login.noAccount", "Noch kein Konto? Bitte deinen Admin/Chef fragen, oder", "Belum punya akun? Silakan hubungi admin/bos kamu, atau"],
    ["login.forgot", "Passwort vergessen?", "Lupa kata sandi?"],
    ["login.forgotEmailLabel", "E-Mail für den Wiederherstellungslink", "Email untuk tautan pemulihan"],
    ["login.reset", "Zurücksetzen", "Kirim ulang"], ["login.registerBusiness", "dein Unternehmen registrieren", "daftarkan bisnis"],
    ["settings.title", "Einstellungen", "Pengaturan"], ["settings.language", "Sprache", "Bahasa"],
    ["settings.saveNote", "Deine Auswahl wird automatisch gespeichert.", "Pilihanmu tersimpan otomatis."],

    // ---- common ----
    ["Save", "Speichern", "Simpan"], ["Cancel", "Abbrechen", "Batal"], ["Delete", "Löschen", "Hapus"],
    ["Edit", "Bearbeiten", "Ubah"], ["Approve", "Genehmigen", "Setujui"], ["Reject", "Ablehnen", "Tolak"],
    ["Prev.", "Zurück", "Sebelum"], ["Next", "Weiter", "Lanjut"], ["Back", "Zurück", "Kembali"],
    ["Done", "Fertig", "Selesai"], ["Submit", "Senden", "Kirim"], ["Yes", "Ja", "Ya"], ["No", "Nein", "Tidak"],
    ["Apply", "Anwenden", "Terapkan"], ["Reset", "Zurücksetzen", ""], ["Export", "", "Ekspor"],
    ["Export CSV", "CSV exportieren", "Ekspor CSV"], ["Assign", "Zuweisen", ""], ["Undo", "Rückgängig", "Urungkan"],
    ["Publish", "Veröffentlichen", ""], ["Select", "Wählen", "Pilih"], ["Send", "Senden", "Kirim"],
    ["Add", "Hinzufügen", "Tambah"], ["Logout", "Abmelden", "Keluar"], ["Log out", "Abmelden", "Keluar"],
    ["Unknown", "Unbekannt", "Tidak diketahui"], ["Saved", "Gespeichert", "Tersimpan"],
    ["Pending", "Ausstehend", "Menunggu"], ["Approved", "Genehmigt", "Disetujui"], ["Rejected", "Abgelehnt", "Ditolak"],
    ["pending", "ausstehend", "menunggu"], ["approved", "genehmigt", "disetujui"], ["rejected", "abgelehnt", "ditolak"],
    ["Name", "", "Nama"], ["Open", "Offen", "Kosong"], ["Mitarbeiter", "", "orang"],
    ["{what}: coming soon", "{what}: kommt bald", "{what}: segera hadir"],

    // ---- header / footer ----
    ["Good morning", "Guten Morgen", "Selamat pagi"], ["Good day", "Guten Tag", "Selamat siang"],
    ["Good evening", "Guten Abend", "Selamat malam"],
    ["{weekday}, {date} - {time}", "{weekday}, den {date} - {time}", ""],
    ["No new notifications", "Keine neuen Meldungen", "Tidak ada notifikasi baru"],
    ["{n} approval(s) pending", "{n} Freigabe(n) offen", "{n} persetujuan menunggu"],
    ["{n} open complaint(s)", "{n} offene Beschwerde(n)", "{n} keluhan terbuka"],
    ["{n} leave request(s)", "{n} Urlaubsanfrage(n)", "{n} pengajuan cuti"],
    ["Offline! Data shown may not be accurate. Connect to the internet.", "Offline! Daten evtl. veraltet. Bitte online gehen.", "Offline! Data mungkin tidak akurat. Sambungkan internet."],
    ["Choose your workplace", "Arbeitsplatz wählen", "Pilih tempat kerja"],
    ["You belong to more than one organization.", "Du gehörst zu mehreren Organisationen.", "Kamu ada di lebih dari satu organisasi."],
    ["Admin access required.", "Nur für Admins.", "Khusus admin."], ["Manager access required.", "Nur für Manager.", "Khusus manajer."],

    // ---- login / onboarding / reset ----
    ["Please fill in email and password.", "Bitte E-Mail und Passwort eingeben.", "Isi email dan kata sandi."],
    ["Enter the email your manager added, then tap again.", "Gib die E-Mail ein, die dein Chef hinterlegt hat, und tippe erneut.", "Isi email yang didaftarkan atasanmu, lalu tekan lagi."],
    ["Login link sent to {email} - open it on this device.", "Login-Link an {email} gesendet – öffne ihn auf diesem Gerät.", "Link login dikirim ke {email} – buka di perangkat ini."],
    ["Recovery email sent - check your inbox (and spam folder).", "Wiederherstellungs-E-Mail gesendet – prüfe Posteingang und Spam.", "Email pemulihan terkirim – cek inbox dan spam."],
    ["Show password", "Passwort anzeigen", "Tampilkan sandi"], ["Hide password", "Passwort verbergen", "Sembunyikan sandi"],
    ["First login? Send me a login link", "Erster Login? Link per E-Mail senden", "Login pertama? Kirim link ke email"],
    ["No workplace yet", "Noch kein Arbeitsplatz", "Belum ada tempat kerja"], ["Signed in as", "Angemeldet als", "Masuk sebagai"],
    ["This email is not linked to a workplace. Ask your manager to add it under Manager → Crew, then check again - or register your own business.",
        "Diese E-Mail ist keinem Betrieb zugeordnet. Bitte deinen Chef, sie unter Manager → Crew einzutragen, und prüfe dann erneut – oder registriere dein eigenes Unternehmen.",
        "Email ini belum terhubung ke tempat kerja. Minta atasanmu menambahkannya di Manager → Crew, lalu cek lagi – atau daftarkan bisnismu sendiri."],
    ["Check again", "Erneut prüfen", "Cek lagi"],
    ["Register a business instead", "Stattdessen Unternehmen registrieren", "Daftarkan bisnis saja"],
    ["Register Your Business", "Unternehmen registrieren", "Daftarkan Bisnismu"],
    ["Step {n} of 3", "Schritt {n} von 3", "Langkah {n} dari 3"], ["Your Name", "Dein Name", "Namamu"],
    ["Repeat password", "Passwort wiederholen", "Ulangi kata sandi"],
    ["Please enter your name and email.", "Bitte Name und E-Mail eingeben.", "Isi nama dan email."],
    ["Password must be at least 6 characters.", "Passwort: mindestens 6 Zeichen.", "Kata sandi minimal 6 karakter."],
    ["Passwords do not match.", "Passwörter stimmen nicht überein.", "Kata sandi tidak sama."],
    ["This email is already registered - go back and log in.", "Diese E-Mail ist schon registriert – geh zurück und melde dich an.", "Email ini sudah terdaftar – kembali dan login."],
    ["We sent a confirmation link to {email}. Open it on this device - you will continue here automatically.",
        "Wir haben einen Bestätigungslink an {email} geschickt. Öffne ihn auf diesem Gerät – hier geht es automatisch weiter.",
        "Link konfirmasi dikirim ke {email}. Buka di perangkat ini – kamu lanjut di sini otomatis."],
    ["Resend", "Erneut senden", "Kirim ulang"],
    ["Confirmation email sent again.", "Bestätigungs-E-Mail erneut gesendet.", "Email konfirmasi dikirim ulang."],
    ["Please enter your name.", "Bitte Namen eingeben.", "Isi namamu."],
    ["Organization name is required.", "Name des Unternehmens fehlt.", "Nama organisasi wajib diisi."],
    ["Location not available - you can set it later in Admin.", "Standort nicht verfügbar – später im Admin einstellbar.", "Lokasi tidak tersedia – bisa diatur nanti di Admin."],
    ["Back to login", "Zurück zum Login", "Kembali ke login"],
    ["Organization Name", "Name des Unternehmens", "Nama Organisasi"], ["Timezone", "Zeitzone", "Zona waktu"],
    ["Workplace location (for check-in distance) - optional", "Standort des Betriebs (für Check-in-Abstand) – optional", "Lokasi tempat kerja (jarak check-in) – opsional"],
    ["not set", "nicht gesetzt", "belum diatur"], ["Use my location", "Meinen Standort nutzen", "Pakai lokasiku"],
    ["Stand at your workplace and tap the button, or set it later in Admin.", "Stell dich an deinen Arbeitsplatz und tippe auf den Button – oder stelle es später im Admin ein.", "Berdiri di tempat kerja lalu tekan tombol, atau atur nanti di Admin."],
    ["Team Members (optional - you can add them later in Manager → Crew)", "Team (optional – später unter Manager → Crew ergänzen)", "Anggota tim (opsional – bisa ditambah nanti di Manager → Crew)"],
    ["Employee", "Mitarbeiter", "Karyawan"], ["Manager", "", "Manajer"], ["Full name", "Vollständiger Name", "Nama lengkap"],
    ["+ Add member", "+ Mitglied hinzufügen", "+ Tambah anggota"],
    ["Members log in with the email you enter here. They tap “First login? Send me a login link” on the login screen, or you press Invite on their card later. No email = no login.",
        "Mitglieder melden sich mit der hier eingetragenen E-Mail an: auf dem Login-Screen „Erster Login?“ antippen – oder du drückst später auf ihrer Karte „Einladen“. Ohne E-Mail kein Login.",
        "Anggota login dengan email yang kamu isi di sini: tekan “Login pertama?” di layar login, atau kamu tekan Undang di kartu mereka nanti. Tanpa email, tidak bisa login."],
    ["Creating…", "Wird erstellt…", "Membuat…"], ["Finish Setup", "Fertigstellen", "Selesai"],
    ["Set New Password", "Neues Passwort setzen", "Atur Kata Sandi Baru"], ["Reset Password", "Passwort zurücksetzen", "Reset Kata Sandi"],
    ["Done!", "Fertig!", "Selesai!"], ["Verifying your link…", "Link wird geprüft…", "Memeriksa link…"],
    ["Link expired or invalid. Please request a new recovery email.", "Link abgelaufen oder ungültig. Bitte neue E-Mail anfordern.", "Link kedaluwarsa atau tidak valid. Minta email pemulihan baru."],
    ["New password", "Neues Passwort", "Kata sandi baru"], ["At least 6 characters", "Mindestens 6 Zeichen", "Minimal 6 karakter"],
    ["Confirm password", "Passwort bestätigen", "Konfirmasi kata sandi"],
    ["Repeat your new password", "Neues Passwort wiederholen", "Ulangi kata sandi baru"],
    ["Updating…", "Wird aktualisiert…", "Memperbarui…"], ["Update Password", "Passwort ändern", "Ubah Kata Sandi"],
    ["Password updated. Redirecting to login…", "Passwort geändert. Weiterleitung…", "Kata sandi diubah. Mengalihkan…"],

    // ---- dashboard ----
    ["My Shift", "Meine Schicht", "Shift Saya"], ["No shifts scheduled.", "Keine Schichten geplant.", "Belum ada shift."],
    ["Open Shift", "Offene Schicht", "Shift Kosong"], ["Today’s Shift", "Heutige Schicht", "Shift Hari Ini"],
    ["Extra Shift", "Zusatzschicht", "Shift Tambahan"],
    ["Location permission denied - showing workplace only.", "Standortzugriff verweigert – nur Arbeitsplatz sichtbar.", "Izin lokasi ditolak – hanya tempat kerja yang tampil."],
    ["Allow", "Erlauben", "Izinkan"],
    ["Geolocation not supported - showing workplace only.", "Standort nicht unterstützt – nur Arbeitsplatz sichtbar.", "Lokasi tidak didukung – hanya tempat kerja yang tampil."],
    ["Locating you…", "Standort wird gesucht…", "Mencari lokasimu…"],
    ["At workplace (~{d} m away)", "Am Arbeitsplatz (~{d} m)", "Di tempat kerja (~{d} m)"],
    ["Not at workplace (~{d} m away)", "Nicht am Arbeitsplatz (~{d} m)", "Tidak di tempat kerja (~{d} m)"],
    ["If nothing happens, enable location for this site in your browser settings.", "Passiert nichts? Erlaube den Standort für diese Seite in den Browser-Einstellungen.", "Kalau tidak ada reaksi, izinkan lokasi untuk situs ini di pengaturan browser."],
    ["You already have an overlapping shift", "Du hast schon eine überschneidende Schicht", "Kamu sudah punya shift yang bentrok"],
    ["Request sent - waiting for approval", "Anfrage gesendet – wartet auf Freigabe", "Permintaan terkirim – menunggu persetujuan"],
    ["Check-in blocked - you are ~{d} m from the workplace.", "Check-in blockiert – du bist ~{d} m vom Arbeitsplatz entfernt.", "Check-in diblokir – kamu ~{d} m dari tempat kerja."],
    ["Checked in", "Eingecheckt", "Sudah check-in"],
    ["Checked out - waiting for approval", "Ausgecheckt – wartet auf Freigabe", "Check-out – menunggu persetujuan"],
    ["Area", "Bereich", ""], ["Role", "Rolle", "Peran"], ["Scheduled", "Geplant", "Terjadwal"], ["Elapsed", "Dauer", "Durasi"],
    ["Comment", "Kommentar", "Komentar"], ["optional", "", "opsional"],
    ["Recent Entries", "Letzte Einträge", "Entri Terbaru"], ["Workplace", "Arbeitsplatz", "Tempat kerja"],
    ["You are here", "Du bist hier", "Kamu di sini"], ["No entries yet.", "Noch keine Einträge.", "Belum ada entri."],
    ["File Complaint", "Beschwerde einreichen", "Ajukan Keluhan"],
    ["What is wrong with this entry?", "Was stimmt bei diesem Eintrag nicht?", "Apa yang salah dengan entri ini?"],
    ["Evidence (optional photo / PDF)", "Beleg (optional Foto / PDF)", "Bukti (foto / PDF, opsional)"],
    ["Complaint filed - a manager will review it", "Beschwerde eingereicht – ein Manager prüft sie", "Keluhan terkirim – akan ditinjau manajer"],
    ["Send request to work on {date} ({time})?", "Anfrage senden, um am {date} ({time}) zu arbeiten?", "Kirim permintaan kerja pada {date} ({time})?"],

    // ---- roster ----
    ["Roster", "Dienstplan", "Jadwal"], ["KW {n}", "", "Minggu {n}"], ["Weekly", "Woche", "Mingguan"], ["Monthly", "Monat", "Bulanan"],
    ["(request)", "(Anfrage)", "(permintaan)"], ["(deleted - publish to apply)", "(gelöscht – erst nach Veröffentlichen)", "(dihapus – publish untuk menerapkan)"],
    ["(draft)", "(Entwurf)", "(draf)"], ["No staff found", "Keine Mitarbeiter gefunden", "Staf tidak ditemukan"],
    ["{name} works 6 days non stop!", "{name} arbeitet 6 Tage am Stück!", "{name} kerja 6 hari berturut-turut!"],
    ["Open shift {d}: nobody applied!", "Offene Schicht {d}: keine Bewerbung!", "Shift kosong {d}: belum ada pelamar!"],
    ["Open shift {d}: {n} applicants, choose one!", "Offene Schicht {d}: {n} Bewerber, bitte wählen!", "Shift kosong {d}: {n} pelamar, pilih satu!"],
    ["Undone", "Rückgängig gemacht", "Dibatalkan"], ["Nothing to publish", "Nichts zu veröffentlichen", "Tidak ada yang dipublish"],
    ["Publish {n} change(s)? Employees will see them. This is final and cannot be undone.", "{n} Änderung(en) veröffentlichen? Mitarbeiter sehen sie sofort. Das ist endgültig.", "Publish {n} perubahan? Karyawan akan melihatnya. Ini final dan tidak bisa dibatalkan."],
    ["Published {n} change(s)", "{n} Änderung(en) veröffentlicht", "{n} perubahan dipublish"],
    ["You already have an entry on that day", "Du hast an dem Tag schon einen Eintrag", "Kamu sudah punya entri di hari itu"],
    ["Note - {d}", "Vermerk - {d}", "Catatan - {d}"], ["Note / Event", "Vermerk / Event", "Catatan / Acara"],
    ["Note / Event (every week)", "Vermerk / Event (jede Woche)", "Catatan / Acara (tiap minggu)"],
    ["Empty + Save = delete.", "Leer + Speichern = löschen.", "Kosong + Simpan = hapus."],
    ["Note saved", "Vermerk gespeichert", "Catatan tersimpan"],
    ["Open shift added - publish to apply", "Offene Schicht hinzugefügt – zum Anwenden veröffentlichen", "Shift kosong ditambah – publish untuk menerapkan"],
    ["Shift assigned", "Schicht zugewiesen", "Shift ditetapkan"],
    ["Shift updated - publish to apply", "Schicht geändert – zum Anwenden veröffentlichen", "Shift diubah – publish untuk menerapkan"],
    ["Request approved", "Anfrage genehmigt", "Permintaan disetujui"], ["Shift deleted", "Schicht gelöscht", "Shift dihapus"],
    ["Shift marked for deletion - publish to apply", "Schicht zum Löschen markiert – zum Anwenden veröffentlichen", "Shift ditandai hapus – publish untuk menerapkan"],
    ["Request rejected", "Anfrage abgelehnt", "Permintaan ditolak"],
    ["Overlaps another shift on {d}", "Überschneidung mit anderer Schicht am {d}", "Bentrok dengan shift lain pada {d}"],
    ["Failed to check for conflicts", "Konfliktprüfung fehlgeschlagen", "Gagal memeriksa bentrok"],

    // ---- assign popup ----
    ["Edit Shift", "Schicht bearbeiten", "Ubah Shift"], ["Request", "Anfrage", "Permintaan"], ["Date", "Datum", "Tanggal"],
    ["Shift", "Schicht", ""], ["Start time", "Beginn", "Jam mulai"], ["End time", "Ende", "Jam selesai"],
    ["Send request", "Anfrage senden", "Kirim permintaan"],
    ["date", "Datum", "tanggal"], ["employee", "Mitarbeiter", "karyawan"], ["shift", "Schicht", ""], ["area", "Bereich", ""],
    ["role", "Rolle", "peran"], ["start time", "Beginn", "jam mulai"], ["end time", "Ende", "jam selesai"],
    ["Please fill in all fields (missing: {list}).", "Bitte alle Felder ausfüllen (fehlt: {list}).", "Isi semua kolom (kurang: {list})."],
    ["Delete this shift?", "Diese Schicht löschen?", "Hapus shift ini?"],

    // ---- leave (Hours page) ----
    ["Nothing here", "Nichts hier", "Kosong"], ["{n} Days", "{n} Tage", "{n} hari"],
    ["Date is in the past", "Datum liegt in der Vergangenheit", "Tanggal sudah lewat"],
    ["There is already a request on that day", "An dem Tag gibt es schon eine Anfrage", "Sudah ada permintaan di hari itu"],
    ["Nothing to send", "Nichts zu senden", "Tidak ada yang dikirim"],
    ["{label} request sent - waiting for approval", "{label}-Anfrage gesendet – wartet auf Freigabe", "Permintaan {label} terkirim – menunggu persetujuan"],
    ["Reason (optional)", "Grund (optional)", "Alasan (opsional)"],

    // ---- Zeiterfassung ----
    ["Dates", "Datum", "Tanggal"], ["Pause", "", "Istirahat"], ["Balance", "Saldo", "Saldo"], ["Notes", "Notizen", "Catatan"],
    ["No entries.", "Keine Einträge.", "Tidak ada entri."], ["Soll", "", "Target"],
    ["Total Elapsed", "Gesamt Dauer", "Total Durasi"], ["Total Target", "Gesamt Soll", "Total Target"], ["Total Balance", "Gesamt Saldo", "Total Saldo"],
    ["Edit - {month}", "Bearbeiten – {month}", "Ubah – {month}"],
    ["Hours (e.g. 1.5). Korrektur may be negative. 0 = delete.", "Stunden (z. B. 1,5). Korrektur darf negativ sein. 0 = löschen.", "Jam (mis. 1,5). Koreksi boleh negatif. 0 = hapus."],
    ["Note", "Notiz", "Catatan"], ["Failed to load timesheet", "Zeiterfassung konnte nicht geladen werden", "Gagal memuat catatan waktu"],
    ["Soll-Stunden", "", "Jam target"], ["Ist-Stunden", "", "Jam aktual"], ["Plan Stunden", "", "Jam terjadwal"],
    ["Differenz", "", "Selisih"], ["Übertrag Vormonat", "", "Sisa bulan lalu"], ["Gesamtsaldo", "", "Saldo total"],
    ["Überstunden", "", "Lembur"], ["Minusstunden", "", "Jam kurang"], ["Manuelle Korrektur", "", "Koreksi manual"],
    ["Ausbezahlte Urlaub", "", "Cuti dibayar"], ["Freizeitausgleich", "", "Pengganti libur"], ["Verfallene Stunden", "", "Jam hangus"],
    ["Urlaubsstunden", "", "Jam cuti"], ["Krankheitsstunden", "", "Jam sakit"], ["Feiertagsstunden", "", "Jam hari libur"],
    ["Nachtstunden", "", "Jam malam"], ["Sonn- & Feiertagsstunden", "", "Jam Minggu & libur"], ["Pausenzeit", "", "Waktu istirahat"],
    ["Freiwünsche", "", "Permintaan Libur"], ["Frei", "", "Libur"], ["Urlaub", "", "Cuti"],
    ["Jahresurlaub", "", "Cuti tahunan"], ["Resturlaub", "", "Sisa cuti"], ["Sonderurlaub", "", "Cuti khusus"],
    ["Gesamtanspruch", "", "Total hak cuti"], ["Genommener Urlaub", "", "Cuti terpakai"], ["Geplanter Urlaub", "", "Cuti terjadwal"],
    ["Beantragter Urlaub", "", "Cuti diajukan"], ["Resturlaub aktuell", "", "Sisa cuti saat ini"],
    ["Freiwunsch", "", "Permintaan libur"], ["Krank", "", "Sakit"],

    // ---- activity ----
    ["Time", "Zeit", "Waktu"], ["Member", "Mitglied", "Anggota"], ["Action", "Aktion", "Aksi"], ["Summary", "Zusammenfassung", "Ringkasan"],
    ["{n} entries", "{n} Einträge", "{n} entri"], ["No activity found.", "Keine Aktivität gefunden.", "Tidak ada aktivitas."],
    ["Full timestamp", "Genauer Zeitpunkt", "Waktu lengkap"], ["Actor role", "Rolle", "Peran pelaku"], ["Entity type", "Objekt", "Jenis data"],
    ["Delete Entry", "Eintrag löschen", "Hapus Entri"], ["Page {p} / {n}", "Seite {p} / {n}", "Halaman {p} / {n}"],
    ["Search", "Suche", "Cari"], ["Search…", "Suchen…", "Cari…"], ["All actions", "Alle Aktionen", "Semua aksi"],
    ["User", "Nutzer", "Pengguna"], ["All users", "Alle Nutzer", "Semua pengguna"],
    ["Delete this history entry permanently?", "Diesen Eintrag endgültig löschen?", "Hapus entri ini permanen?"],
    ["Settings Changed", "Einstellungen geändert", "Pengaturan diubah"], ["Crew Added", "Crew hinzugefügt", "Crew ditambah"],
    ["Crew Updated", "Crew geändert", "Crew diubah"], ["Crew Deactivated", "Crew deaktiviert", "Crew dinonaktifkan"],
    ["Crew Reactivated", "Crew reaktiviert", "Crew diaktifkan lagi"], ["Role Changed", "Rolle geändert", "Peran diubah"],
    ["Shift Moved", "Schicht verschoben", "Shift dipindah"], ["Shift Change Approved", "Schichtänderung genehmigt", "Perubahan shift disetujui"],
    ["Manual Time Edit", "Zeit manuell geändert", "Waktu diubah manual"], ["Leave Requested", "Urlaub beantragt", "Cuti diajukan"],
    ["Leave Approved", "Urlaub genehmigt", "Cuti disetujui"], ["Leave Rejected", "Urlaub abgelehnt", "Cuti ditolak"],
    ["Open Shift Assigned", "Offene Schicht vergeben", "Shift kosong ditetapkan"], ["Recovery Sent", "Wiederherstellung gesendet", "Pemulihan terkirim"],
    ["Data Exported", "Daten exportiert", "Data diekspor"],

    // ---- manager ----
    ["Pending Shift Approval", "Schicht-Freigaben offen", "Persetujuan Shift Menunggu"],
    ["Open Shift Requests", "Anfragen zu offenen Schichten", "Permintaan Shift Kosong"], ["Complaints", "Beschwerden", "Keluhan"],
    ["Leave Request", "Urlaubsanträge", "Pengajuan Cuti"], ["Nothing pending.", "Nichts offen.", "Tidak ada yang menunggu."],
    ["Shift change: {d} · {t}", "Schichtänderung: {d} · {t}", "Perubahan shift: {d} · {t}"],
    ["Delete this entry permanently?", "Diesen Eintrag endgültig löschen?", "Hapus entri ini permanen?"],
    ["Cannot approve - this overlaps another shift", "Nicht möglich – überschneidet andere Schicht", "Tidak bisa disetujui – bentrok dengan shift lain"],
    ["Auto-assign single applicant", "Einzelnen Bewerber automatisch zuweisen", "Tetapkan otomatis jika 1 pelamar"],
    ["No open shift requests.", "Keine Anfragen zu offenen Schichten.", "Tidak ada permintaan shift kosong."],
    ["No open complaints.", "Keine offenen Beschwerden.", "Tidak ada keluhan terbuka."],
    ["Delete this complaint?", "Diese Beschwerde löschen?", "Hapus keluhan ini?"],
    ["No pending leave requests.", "Keine offenen Urlaubsanträge.", "Tidak ada pengajuan cuti."],
    ["Start", "", "Mulai"], ["End", "Ende", "Selesai"], ["Duration {n} Days", "Dauer {n} Tage", "Durasi {n} hari"],
    ["Name and email are required.", "Name und E-Mail sind Pflicht.", "Nama dan email wajib diisi."],
    ["Organization must keep at least one active manager/admin.", "Es muss mind. ein aktiver Manager/Admin bleiben.", "Harus ada minimal satu manajer/admin aktif."],
    ["This member has no email yet - add one first.", "Dieses Mitglied hat noch keine E-Mail – bitte zuerst eintragen.", "Anggota ini belum punya email – tambahkan dulu."],
    ["Recovery email sent to {email}", "Wiederherstellungs-E-Mail an {email} gesendet", "Email pemulihan dikirim ke {email}"],
    ["Invitation email sent to {email}", "Einladung an {email} gesendet", "Undangan dikirim ke {email}"],
    ["Active", "Aktiv", "Aktif"], ["Deactivated", "Deaktiviert", "Nonaktif"], ["{n} Std/Woche", "", "{n} jam/minggu"],
    ["Recover", "Zurücksetzen", "Pulihkan"], ["Invite", "Einladen", "Undang"], ["Deactivate", "Deaktivieren", "Nonaktifkan"],
    ["Reactivate", "Reaktivieren", "Aktifkan"], ["Edit Crew Member", "Crew bearbeiten", "Ubah Anggota Crew"],
    ["First name", "Vorname", "Nama depan"], ["Last name", "Nachname", "Nama belakang"], ["Vertrag", "", "Kontrak"],
    ["Vollzeit", "", "Penuh waktu"], ["Teilzeit", "", "Paruh waktu"], ["Hours/week", "Std/Woche", "Jam/minggu"],
    ["Job title (e.g. Waiter)", "Position (z. B. Servicekraft)", "Jabatan (mis. Pelayan)"], ["Phone", "Telefon", "Telepon"],

    // ---- admin / settings ----
    ["Saving…", "Speichert…", "Menyimpan…"], ["Organization", "Organisation", "Organisasi"],
    ["Location & Check-in", "Standort & Check-in", "Lokasi & Check-in"],
    ["Workplace latitude", "Breitengrad Betrieb", "Latitude tempat kerja"], ["Workplace longitude", "Längengrad Betrieb", "Longitude tempat kerja"],
    ["Check-in radius (meters)", "Check-in-Radius (Meter)", "Radius check-in (meter)"],
    ["Outside-radius behavior", "Außerhalb des Radius", "Di luar radius"],
    ["Allow silently", "Still erlauben", "Izinkan tanpa pesan"], ["Warn only", "Nur warnen", "Beri peringatan"],
    ["Block check-in", "Check-in blockieren", "Blokir check-in"],
    ["Google Maps link or “lat, lng” - coordinates are extracted automatically", "Google-Maps-Link oder „lat, lng“ – Koordinaten werden automatisch gelesen", "Link Google Maps atau “lat, lng” – koordinat diambil otomatis"],
    ["Extract", "Auslesen", "Ambil"],
    ["Could not find coordinates in that link/text.", "Keine Koordinaten gefunden.", "Koordinat tidak ditemukan."],
    ["Extracted: {lat}, {lng} - remember to Save.", "Gefunden: {lat}, {lng} – bitte speichern.", "Ditemukan: {lat}, {lng} – jangan lupa Simpan."],
    ["Staff Role Labels", "Rollen", "Peran staf"],
    ["One per line - these fill the role dropdown on the Dashboard.", "Eine pro Zeile – sie füllen die Rollen-Auswahl im Dashboard.", "Satu per baris – dipakai di pilihan peran pada Dashboard."],
    ["Scheduling Rules", "Planungsregeln", "Aturan jadwal"],
    ["Leave request cut-off (days ahead)", "Antragsfrist (Tage vorher)", "Batas pengajuan cuti (hari sebelumnya)"],
    ["Min shift duration (hours)", "Min. Schichtdauer (Std.)", "Durasi shift min. (jam)"],
    ["Max shift duration (hours)", "Max. Schichtdauer (Std.)", "Durasi shift maks. (jam)"],
    ["Annual leave (days per year)", "Jahresurlaub (Tage pro Jahr)", "Cuti tahunan (hari per tahun)"],
    ["Shift Presets", "Schicht-Vorlagen", "Preset shift"],
    ["Code · name · color · type · default start/end. “Off” types (e.g. U, Sch) fill the whole day.", "Kürzel · Name · Farbe · Art · Standard-Start/-Ende. „Frei“-Arten (z. B. U, Sch) füllen den ganzen Tag.", "Kode · nama · warna · jenis · jam mulai/selesai default. Jenis “Libur” (mis. U, Sch) memenuhi satu hari."],
    ["Code", "Kürzel", "Kode"], ["Remove", "Entfernen", "Hapus"], ["Work", "Arbeit", "Kerja"], ["Day off", "Frei", "Libur"],
    ["+ Add shift", "+ Schicht hinzufügen", "+ Tambah shift"], ["Areas - one per line", "Bereiche – einer pro Zeile", "Area – satu per baris"],
    ["Save presets", "Vorlagen speichern", "Simpan preset"],
    ["All", "Alle", "Semua"],
    ["Requests need {n} days notice", "Anträge brauchen {n} Tage Vorlauf", "Pengajuan butuh {n} hari sebelumnya"],
    ["Shift is shorter than {n} h", "Schicht ist kürzer als {n} Std.", "Shift lebih pendek dari {n} jam"],
    ["Shift is longer than {n} h", "Schicht ist länger als {n} Std.", "Shift lebih panjang dari {n} jam"],
    ["{field}: not a number", "{field}: keine Zahl", "{field}: bukan angka"],
    ["No crew found.", "Keine Crew gefunden.", "Crew tidak ditemukan."],
    ["Name / email", "Name / E-Mail", "Nama / email"],
    ["No members yet. Tap “+ Add member”.", "Noch keine Mitglieder. Tippe auf „+ Mitglied hinzufügen“.", "Belum ada anggota. Tekan “+ Tambah anggota”."],
    ["Remove member", "Mitglied entfernen", "Hapus anggota"],
    ["Shift Reminders", "Schicht-Erinnerungen", "Pengingat shift"], ["On", "An", ""], ["Off", "Aus", ""],
    ["Changes saved", "Änderungen gespeichert", "Perubahan tersimpan"],
    ["Push notifications are not supported in this browser.", "Push-Meldungen werden von diesem Browser nicht unterstützt.", "Browser ini tidak mendukung notifikasi push."],
    ["Notifications are blocked in your browser settings - enable them for this site to receive reminders.", "Meldungen sind in den Browser-Einstellungen blockiert – erlaube sie für diese Seite, um Erinnerungen zu erhalten.", "Notifikasi diblokir di pengaturan browser – izinkan untuk situs ini agar dapat pengingat."],
    ["Get a notification 15 minutes before your shift starts or ends - even when the app is closed.", "Bekomme 15 Minuten vor Schichtbeginn oder -ende eine Meldung – auch bei geschlossener App.", "Dapat notifikasi 15 menit sebelum shift mulai atau selesai – meski aplikasi ditutup."]
];

// English text for the dotted keys and the German-source keys (everything else: the key IS the English text)
const EN: Dict = {
    "hours.freiwunsch": "Time Off Request", "hours.urlaub": "Vacation",
    "nav.dashboard": "Overview", "nav.schedule": "Schedule", "nav.hours": "Times", "nav.manager": "Manager",
    "nav.timesheet": "Time Tracking", "nav.leave": "Time Off & Vacation", "nav.admin": "Admin",
    "nav.history": "Activity", "nav.settings": "Settings",
    "login.title": "Dienstplan Login", "login.email": "Email", "login.password": "Password",
    "login.remember": "Remember me on this device", "login.submit": "Log in",
    "login.noAccount": "No account yet? Please ask your admin / boss, or",
    "login.forgot": "Forgot password?", "login.forgotEmailLabel": "Email for the recovery link",
    "login.reset": "Reset", "login.registerBusiness": "register your business",
    "settings.title": "Settings", "settings.language": "Language", "settings.saveNote": "Your choice is saved automatically.",
    "KW {n}": "Week {n}", "Mitarbeiter": "staff", "{n} Std/Woche": "{n} h/week",
    "Soll-Stunden": "Target hours", "Ist-Stunden": "Actual hours", "Plan Stunden": "Planned hours", "Differenz": "Difference",
    "Übertrag Vormonat": "Carry-over", "Gesamtsaldo": "Total balance", "Überstunden": "Overtime", "Minusstunden": "Minus hours",
    "Manuelle Korrektur": "Manual correction", "Ausbezahlte Urlaub": "Paid-out leave", "Freizeitausgleich": "Time off in lieu",
    "Verfallene Stunden": "Expired hours", "Urlaubsstunden": "Vacation hours", "Krankheitsstunden": "Sick hours",
    "Feiertagsstunden": "Holiday hours", "Nachtstunden": "Night hours", "Sonn- & Feiertagsstunden": "Sun & holiday hours",
    "Pausenzeit": "Break time", "Freiwünsche": "Day Off Wishes", "Frei": "Off", "Urlaub": "Vacation",
    "Jahresurlaub": "Annual leave", "Resturlaub": "Leave left", "Sonderurlaub": "Special leave", "Gesamtanspruch": "Total entitlement",
    "Genommener Urlaub": "Leave taken", "Geplanter Urlaub": "Leave planned", "Beantragter Urlaub": "Leave requested",
    "Resturlaub aktuell": "Leave left now", "Freiwunsch": "Day off wish", "Krank": "Sick", "Soll": "Target",
    "Vertrag": "Contract", "Vollzeit": "Full-time", "Teilzeit": "Part-time"
};

const DE: Dict = {}, ID: Dict = {};
for (const [k, d, i] of ROWS) { if (d) DE[k] = d; if (i) ID[k] = i; }
const TRANSLATIONS: Record<Language, Dict> = { de: DE, en: EN, id: ID };

interface UserSettings { language: Language; notificationsEnabled: boolean; }

const KEY = "dienstplan_settings_v1";
const DEFAULTS: UserSettings = { language: "de", notificationsEnabled: false };

function load(): UserSettings {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
    catch { return { ...DEFAULTS }; }
}

// current language lives at module level so ANY file can call tr() without hooks;
// main.tsx remounts the app when it changes
let current: Language = load().language;

export function tr(key: string, vars?: Record<string, string | number>): string {
    const s = TRANSLATIONS[current][key] ?? EN[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
}

interface Ctx {
    settings: UserSettings;
    update: (patch: Partial<UserSettings>) => void;
    t: typeof tr;
}

const SettingsCtx = createContext<Ctx>(null!);
export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }: { children: ReactNode }) {

    const [settings, setSettings] = useState(load);
    current = settings.language;

    useEffect(() => {
        document.documentElement.lang = settings.language;
        try { localStorage.setItem(KEY, JSON.stringify(settings)); }
        catch (err) { console.error("Failed to save settings:", err); }
    }, [settings]);

    const update = useCallback((patch: Partial<UserSettings>) => setSettings(s => ({ ...s, ...patch })), []);

    const value = useMemo(() => ({ settings, update, t: tr }), [settings, update]);

    return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}