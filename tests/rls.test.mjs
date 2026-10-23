// RLS + Storage policy tests against the local Supabase stack.
// Run with `npm test` (resets the local DB to migrations + seed first).
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(execSync('supabase status -o env', { encoding: 'utf8' })
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const URL = env.API_URL;
const ANON = env.ANON_KEY;
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const client = () => createClient(URL, ANON, { auth: { persistSession: false } });
async function as(email) { const c = client(); const { error } = await c.auth.signInWithPassword({ email, password: 'demo1234' }); if (error) throw error; return c; }

// anon
const a = client();
let r = await a.from('listings').select('*');
check('anon: listings blocked', !r.error && r.data.length === 0, `${r.data?.length} rows`);
r = await a.rpc('get_listing_previews', { p_category: null, p_limit: 12 });
check('anon: previews visible, safe columns only', r.data?.length === 4 && !('price_cents' in r.data[0]) && !('contact_email' in r.data[0]), Object.keys(r.data?.[0] || {}).join(','));
r = await a.from('profiles').select('*');
check('anon: profiles blocked', r.data?.length === 0 || !!r.error);

// pending
const p = await as('pending@demo.com');
r = await p.from('profiles').select('membership_status').single();
check('pending: reads own profile', r.data?.membership_status === 'pending');
r = await p.from('listings').select('*');
check('pending: listings blocked', r.data?.length === 0, `${r.data?.length} rows`);
r = await p.from('profiles').update({ membership_status: 'active' }).eq('id', (await p.auth.getUser()).data.user.id);
check('pending: cannot self-activate', !!r.error, r.error?.message);
r = await p.from('profiles').update({ display_name: 'Sam R.' }).eq('id', (await p.auth.getUser()).data.user.id).select();
check('pending: can edit display_name', !r.error && r.data?.length === 1);
r = await p.from('saved_listings').insert({ listing_id: (await a.rpc('get_listing_previews', {})).data[0].id });
check('pending: cannot save', !!r.error, r.error?.code);

// active member
const m = await as('member@demo.com');
const mid = (await m.auth.getUser()).data.user.id;
r = await m.from('listings').select('*', { count: 'exact' }).eq('status', 'published');
check('member: sees published listings', r.data?.length === 4);
r = await m.from('listings').select('id').eq('status', 'draft');
check("member: can't see others' drafts", r.data?.length === 0);
r = await m.from('listings').select('title').textSearch('fts', 'brass lamp', { type: 'websearch', config: 'english' });
check('member: full-text search', r.data?.length === 1, r.data?.[0]?.title);
const lid = (await m.from('listings').select('id').limit(1)).data[0].id;
r = await m.from('saved_listings').insert({ listing_id: lid });
check('member: save listing', !r.error, r.error?.message);
r = await m.from('saved_listings').insert({ listing_id: lid, user_id: '33333333-3333-4333-8333-333333333333' });
check("member: can't save as someone else", !!r.error, r.error?.code);
r = await m.from('listings').insert({ title: 'Test lamp', category: 'Lighting', seller_display_name: 'Spoofed' }).select().single();
check('member: create listing, seller name set by server', !r.error && r.data.seller_display_name === 'Jordan Lee', r.error?.message || r.data.seller_display_name);
r = await m.from('listings').insert({ title: 'Spoof', category: 'Lighting', seller_id: '33333333-3333-4333-8333-333333333333' });
check("member: can't post as another seller", !!r.error, r.error?.code);
r = await m.from('listings').update({ title: 'Hacked' }).eq('seller_id', '33333333-3333-4333-8333-333333333333').select();
check("member: can't edit others' listings", r.data?.length === 0);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
r = await m.storage.from('listing-images').upload(`${mid}/t.png`, png, { contentType: 'image/png', upsert: true });
check('member: upload to own folder', !r.error, r.error?.message);
r = await m.storage.from('listing-images').upload(`33333333-3333-4333-8333-333333333333/x.png`, png, { contentType: 'image/png' });
check("member: can't upload to another's folder", !!r.error, r.error?.message);
r = await m.storage.from('listing-images').createSignedUrls([`${mid}/t.png`], 3600);
const fetched = r.data?.[0]?.signedUrl ? (await fetch(r.data[0].signedUrl)).status : 0;
check('member: signed URL works', fetched === 200, `HTTP ${fetched}`);
r = await p.storage.from('listing-images').createSignedUrls([`${mid}/t.png`], 3600);
check('pending: no signed URL for images', !r.data?.[0]?.signedUrl);
r = await a.storage.from('listing-images').download(`${mid}/t.png`);
check('anon: image download blocked', !!r.error);

// seller sees own draft
const s = await as('ines@demo.com');
r = await s.from('listings').select('id').eq('status', 'draft');
check('seller: sees own draft', r.data?.length === 1);

// reset email accepted
r = await a.auth.resetPasswordForEmail('member@demo.com', { redirectTo: 'http://127.0.0.1:3000/reset-password' });
check('password reset email sent', !r.error, r.error?.message);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
