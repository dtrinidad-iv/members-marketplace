-- Admin helpers — run with the service role / SQL editor, never from the browser.

-- Approve a member (e.g. after payment webhook or manual review):
-- update public.profiles set membership_status = 'active'
-- where id = (select id from auth.users where email = 'someone@example.com');

-- Suspend a member (their access to listings + images stops on the next request):
-- update public.profiles set membership_status = 'suspended' where id = '<uuid>';

-- Verify RLS from the SQL editor by impersonating a role:
-- set local role anon;
-- select count(*) from public.listings;               -- expect 0 (RLS)
-- select * from public.get_listing_previews(null, 5); -- teaser columns only
-- reset role;
