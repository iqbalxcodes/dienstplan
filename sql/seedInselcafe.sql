-- ======================================================
-- Seed: Inselcafe
-- Prasyarat: bikin dulu 6 akun di Supabase Dashboard ->
-- Authentication -> Add user, dengan email PERSIS seperti di
-- bawah (ganti passwordnya sendiri, email boleh diganti asal
-- konsisten dengan tabel `values` di bawah).
-- ======================================================

insert into organizations (name, slug)
values ('Inselcafe', 'inselcafe');

insert into memberships (organization_id, user_id, role, full_name, weekly_target_hours)
select o.id, u.id, r.role, r.full_name, r.weekly_target_hours
from organizations o
cross join (values
    ('admin@inselcafe.com',     'owner',    'Admin',      40),
    ('hasan@inselcafe.com',     'manager',  'Hasan',      40),
    ('monica@inselcafe.com',    'employee', 'Monica',     40),
    ('friska@inselcafe.com',    'employee', 'Friska',     40),
    ('intan@inselcafe.com',     'employee', 'Intan',      40),
    ('yen@inselcafe.com',       'employee', 'Yen',        40),
    ('ahmad@inselcafe.com',       'employee', 'Ahmad',        40),
    ('wisam@inselcafe.com',       'employee', 'Wisam',        40),
    ('anastasia@inselcafe.com', 'employee', 'Anastasia',  40)
) as r(email, role, full_name, weekly_target_hours)
join auth.users u on u.email = r.email
where o.slug = 'inselcafe';

-- cek hasil
select full_name, role from memberships m
join organizations o on o.id = m.organization_id
where o.slug = 'inselcafe';