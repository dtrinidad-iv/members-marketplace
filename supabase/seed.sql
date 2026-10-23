-- Local development seed (runs on `supabase start` / `supabase db reset`).
-- Same demo accounts as the prototype; password for all: demo1234

with u (id, email, name) as (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'member@demo.com',  'Jordan Lee'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'pending@demo.com', 'Sam Rivera'),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'ines@demo.com',    'Inés Duarte'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'theo@demo.com',    'Theo Marsh')
), users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', name),
         now(), now(), '', '', '', ''
  from u
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from users;

-- handle_new_user() created the profiles as 'pending'; activate everyone but Sam.
update public.profiles set membership_status = 'active'
where id <> '22222222-2222-4222-8222-222222222222';

insert into public.listings (seller_id, title, description, category, city, price_cents, contact_email, status) values
  ('33333333-3333-4333-8333-333333333333', 'Walnut lounge chair, restored', 'Mid-century walnut frame, re-oiled, new wool cushions.', 'Furniture', 'Portland', 68000, 'ines@demo.com', 'published'),
  ('44444444-4444-4444-8444-444444444444', 'Hand-thrown stoneware vase', 'Tall speckled stoneware vase, signed on the base.', 'Ceramics', 'Austin', 9500, 'theo@demo.com', 'published'),
  ('44444444-4444-4444-8444-444444444444', 'Limited risograph print', 'Two-color riso print, edition of 50, A3.', 'Art & Prints', 'Brooklyn', 6000, 'theo@demo.com', 'published'),
  ('33333333-3333-4333-8333-333333333333', 'Brass task lamp', 'Solid brass articulating lamp, rewired, dimmable.', 'Lighting', 'Chicago', 21000, 'ines@demo.com', 'published'),
  ('33333333-3333-4333-8333-333333333333', 'Unfinished: cane armchair', 'Draft listing, visible to its seller only.', 'Furniture', 'Portland', 0, '', 'draft');
