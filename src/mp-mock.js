/* Demo-only backend: same interface as the Supabase backend in mp.js and the
 * same access rules as the migration in supabase/migrations (RLS), kept in localStorage.
 * Lets the prototype run with zero setup. Never ship this to production. */
(function (w) {
  'use strict';

  const KEY = 'mp_mock_v1';
  const CATS = ['Furniture', 'Art & Prints', 'Ceramics', 'Textiles', 'Lighting', 'Services'];

  function hue(s) { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 360; return n; }

  // Little generated "product photos" so the demo needs no external images.
  function art(seed, cat) {
    const h = hue(seed);
    const h2 = (h + 35) % 360;
    const shapes = {
      Furniture: `<rect x="70" y="120" width="260" height="60" rx="14" fill="hsl(${h2} 35% 38%)"/><rect x="90" y="80" width="220" height="55" rx="18" fill="hsl(${h2} 40% 48%)"/><rect x="90" y="178" width="12" height="40" fill="#3b2f2a"/><rect x="298" y="178" width="12" height="40" fill="#3b2f2a"/>`,
      'Art & Prints': `<rect x="110" y="45" width="180" height="200" fill="#fbf7f0" stroke="#2f2a26" stroke-width="10"/><circle cx="200" cy="120" r="38" fill="hsl(${h2} 65% 55%)"/><path d="M128 225 L180 160 L215 195 L240 170 L275 225Z" fill="hsl(${h} 30% 35%)"/>`,
      Ceramics: `<path d="M150 70 h100 c0 30 40 50 40 105 c0 50 -40 70 -90 70 s-90 -20 -90 -70 c0 -55 40 -75 40 -105z" fill="hsl(${h2} 30% 62%)"/><rect x="146" y="60" width="108" height="16" rx="8" fill="hsl(${h2} 30% 50%)"/><path d="M118 170 q82 30 164 0" stroke="#fff" stroke-opacity=".5" stroke-width="6" fill="none"/>`,
      Textiles: `<g fill="hsl(${h2} 45% 50%)"><rect x="95" y="60" width="210" height="180" rx="8"/></g><g stroke="#fff" stroke-opacity=".55" stroke-width="8"><path d="M95 100h210M95 140h210M95 180h210M95 220h210"/></g><path d="M140 60v180M200 60v180M260 60v180" stroke="hsl(${h} 40% 30%)" stroke-opacity=".35" stroke-width="6"/>`,
      Lighting: `<path d="M150 70 h100 l35 85 h-170z" fill="hsl(${h2} 60% 58%)"/><rect x="194" y="155" width="12" height="70" fill="#2f2a26"/><rect x="160" y="225" width="80" height="12" rx="6" fill="#2f2a26"/><circle cx="200" cy="168" r="70" fill="hsl(50 100% 80%)" opacity=".25"/>`,
      Services: `<circle cx="200" cy="120" r="55" fill="hsl(${h2} 40% 50%)"/><rect x="120" y="185" width="160" height="70" rx="35" fill="hsl(${h2} 40% 40%)"/><circle cx="200" cy="120" r="22" fill="#fff" opacity=".35"/>`,
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 40% 90%)"/><stop offset="1" stop-color="hsl(${h} 30% 78%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><ellipse cx="200" cy="262" rx="150" ry="14" fill="#000" opacity=".08"/>${shapes[cat] || shapes.Services}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
  }

  function seed() {
    const sellers = [
      { id: 'u-seller-1', email: 'ines@demo.com', password: 'demo1234', display_name: 'Inés Duarte', membership_status: 'active', role: 'member' },
      { id: 'u-seller-2', email: 'theo@demo.com', password: 'demo1234', display_name: 'Theo Marsh', membership_status: 'active', role: 'member' },
      { id: 'u-seller-3', email: 'amara@demo.com', password: 'demo1234', display_name: 'Amara Okafor', membership_status: 'active', role: 'member' },
    ];
    const users = [
      { id: 'u-member', email: 'member@demo.com', password: 'demo1234', display_name: 'Jordan Lee', membership_status: 'active', role: 'member' },
      { id: 'u-pending', email: 'pending@demo.com', password: 'demo1234', display_name: 'Sam Rivera', membership_status: 'pending', role: 'member' },
      ...sellers,
    ];
    const L = (title, category, city, price, s, days, description) =>
      ({ title, category, city, price_cents: price * 100, seller: s, days, description });
    const raw = [
      L('Walnut lounge chair, restored', 'Furniture', 'Portland', 680, 0, 1, 'Mid-century walnut frame, re-oiled and fitted with new wool cushions. Small mark on the left arm (see photo 3). Pickup only.'),
      L('Hand-thrown stoneware vase', 'Ceramics', 'Austin', 95, 2, 2, 'Tall speckled stoneware vase, food safe glaze inside. 32 cm. Signed on the base.'),
      L('Limited risograph print — "Tidal"', 'Art & Prints', 'Brooklyn', 60, 1, 3, 'Two-color riso print, edition of 50, A3. Ships flat in a rigid mailer.'),
      L('Linen throw, natural dye', 'Textiles', 'Portland', 140, 0, 4, 'Heavyweight Lithuanian linen dyed with madder root. 130 × 180 cm.'),
      L('Brass task lamp', 'Lighting', 'Chicago', 210, 1, 5, 'Solid brass articulating lamp, rewired with cloth cord and a dimmable LED bulb.'),
      L('Interior styling session (2h)', 'Services', 'Remote', 150, 2, 6, 'Video consult: layout, color and sourcing list for one room. Includes a written follow-up.'),
      L('Oak dining bench', 'Furniture', 'Denver', 420, 2, 7, 'White oak, 180 cm, hand-cut joinery. Seats three comfortably.'),
      L('Set of 4 matte mugs', 'Ceramics', 'Brooklyn', 72, 1, 8, 'Wheel-thrown, 350 ml, dishwasher safe. Each one slightly different.'),
      L('Woven wall hanging', 'Textiles', 'Austin', 180, 0, 9, 'Merino and cotton, 60 × 90 cm, with a reclaimed driftwood rod.'),
      L('Paper pendant shade', 'Lighting', 'Portland', 85, 2, 10, 'Handmade mulberry paper on a bamboo frame. 45 cm diameter.'),
      L('Original gouache landscape', 'Art & Prints', 'Denver', 320, 0, 12, 'Gouache on cotton paper, 30 × 40 cm, framed in ash.'),
      L('Custom upholstery service', 'Services', 'Chicago', 250, 1, 14, 'Re-upholster one chair or ottoman. Fabric sourcing available. Price is from.'),
      L('Rattan side table', 'Furniture', 'Austin', 130, 1, 16, 'Vintage rattan, very sturdy, 50 cm tall.'),
      L('Ceramic table lamp base', 'Lighting', 'Brooklyn', 175, 2, 18, 'Glazed stoneware base with linen shade. UL-listed fittings.'),
    ];
    const now = Date.now();
    const listings = raw.map((r, i) => {
      const s = sellers[r.seller];
      const id = `l-${String(i + 1).padStart(2, '0')}`;
      return {
        id, seller_id: s.id, seller_display_name: s.display_name, title: r.title, description: r.description,
        category: r.category, city: r.city, price_cents: r.price_cents, contact_email: s.email,
        image_path: `${s.id}/${id}.svg`, status: 'published',
        created_at: new Date(now - r.days * 86400000).toISOString(),
      };
    });
    listings.push({ // a draft: visible to its seller only — useful to demo RLS
      id: 'l-draft', seller_id: 'u-seller-1', seller_display_name: 'Inés Duarte', title: 'Unfinished: cane armchair',
      description: 'Draft listing', category: 'Furniture', city: 'Portland', price_cents: 0, contact_email: '',
      image_path: null, status: 'draft', created_at: new Date(now).toISOString(),
    });
    const saved = [{ user_id: 'u-member', listing_id: 'l-02', created_at: new Date(now - 3600e3).toISOString() }];
    return { users, listings, saved, session: null };
  }

  function create(opts) {
    const o = Object.assign({ latency: 260, onEmail: () => {}, onLog: () => {} }, opts);
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
    const blobs = {}; // uploaded images (object URLs), in-memory only
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* blocked */ } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms == null ? o.latency * (0.6 + Math.random() * 0.8) : ms));
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const subs = new Set();
    const recoveryTokens = {};

    const uid = () => (db.session ? db.session.user.id : null);
    const me = () => db.users.find((u) => u.id === uid()) || null;
    const isActive = () => !!me() && me().membership_status === 'active';
    const rlsError = (table) => Object.assign(new Error(`new row violates row-level security policy for table "${table}"`), { code: '42501' });

    function makeSession(u) {
      return {
        access_token: `mock.${btoa(JSON.stringify({ sub: u.id, role: 'authenticated', email: u.email })).replace(/=+$/, '')}.sig`,
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: { display_name: u.display_name } },
      };
    }

    function fire(event) {
      persist();
      o.onLog(`auth: ${event}`);
      const s = clone(db.session);
      subs.forEach((cb) => cb(event, s));
    }

    // RLS: listings select policy
    const canSee = (l) => (l.status === 'published' && isActive()) || l.seller_id === uid();
    const rowsFor = () => db.listings.filter(canSee);

    const api = {
      name: 'mock',
      auth: {
        onChange(cb) {
          subs.add(cb);
          setTimeout(() => { o.onLog('auth: INITIAL_SESSION'); cb('INITIAL_SESSION', clone(db.session)); }, 120);
          return () => subs.delete(cb);
        },
        async signIn(email, password) {
          await wait();
          const u = db.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
          if (!u || u.password !== password) throw new Error('Invalid login credentials');
          db.session = makeSession(u);
          fire('SIGNED_IN');
        },
        async signUp(email, password, displayName) {
          await wait();
          if (password.length < 8) throw new Error('Password should be at least 8 characters.');
          if (db.users.some((x) => x.email.toLowerCase() === email.toLowerCase())) throw new Error('User already registered');
          // Mirrors the handle_new_user() trigger: new profiles start as "pending".
          const u = { id: `u-${uuid().slice(0, 8)}`, email, password, display_name: displayName.slice(0, 80), membership_status: 'pending', role: 'member' };
          db.users.push(u);
          db.session = makeSession(u); // demo: email confirmation off → immediate session
          fire('SIGNED_IN');
          return { session: db.session, user: db.session.user };
        },
        async signOut() { await wait(80); db.session = null; fire('SIGNED_OUT'); },
        async sendReset(email) {
          await wait();
          const u = db.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
          if (u) { const t = uuid(); recoveryTokens[t] = u.id; o.onEmail({ to: u.email, token: t }); }
        },
        async updatePassword(password) {
          await wait();
          if (!me()) throw new Error('Auth session missing!');
          if (password.length < 8) throw new Error('Password should be at least 8 characters.');
          me().password = password;
          fire('USER_UPDATED');
        },
      },
      async getProfile(id) {
        await wait(60);
        if (id !== uid()) return null; // profiles: read own
        const u = me();
        return { id: u.id, display_name: u.display_name, membership_status: u.membership_status, role: u.role };
      },
      async listListings({ q, category, maxPrice, sort, page }) {
        await wait();
        const terms = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
        let rows = rowsFor().filter((l) => l.status === 'published')
          .filter((l) => !category || l.category === category)
          .filter((l) => !maxPrice || l.price_cents <= maxPrice * 100)
          .filter((l) => terms.every((t) => `${l.title} ${l.description}`.toLowerCase().includes(t)));
        const by = { price_asc: (a, b) => a.price_cents - b.price_cents, price_desc: (a, b) => b.price_cents - a.price_cents };
        rows.sort(by[sort] || ((a, b) => b.created_at.localeCompare(a.created_at)));
        const size = (w.MP && w.MP.config.pageSize) || 12;
        return { rows: clone(rows.slice(page * size, page * size + size)), total: rows.length };
      },
      async listPreviews({ category, limit }) {
        await wait();
        return db.listings.filter((l) => l.status === 'published' && (!category || l.category === category))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, Math.min(limit || 12, 24))
          .map(({ id, title, category: c, city, created_at }) => ({ id, title, category: c, city, created_at }));
      },
      async getListing(id) { await wait(); const l = rowsFor().find((x) => x.id === id); return l ? clone(l) : null; },
      async savedIds() { await wait(80); return new Set(db.saved.filter((s) => s.user_id === uid()).map((s) => s.listing_id)); },
      async listSaved() {
        await wait();
        const visible = new Map(rowsFor().map((l) => [l.id, l]));
        return clone(db.saved.filter((s) => s.user_id === uid())
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((s) => visible.get(s.listing_id)).filter(Boolean));
      },
      async save(listingId) {
        await wait(180);
        if (!isActive()) throw rlsError('saved_listings');
        if (!db.saved.some((s) => s.user_id === uid() && s.listing_id === listingId)) {
          db.saved.push({ user_id: uid(), listing_id: listingId, created_at: new Date().toISOString() });
          persist();
        }
      },
      async unsave(listingId) {
        await wait(180);
        db.saved = db.saved.filter((s) => !(s.user_id === uid() && s.listing_id === listingId));
        persist();
      },
      async createListing(sellerId, fields, file) {
        await wait(500);
        if (!isActive() || sellerId !== uid()) throw rlsError('listings');
        const id = `l-${uuid().slice(0, 8)}`;
        let image_path = null;
        if (file) { image_path = `${uid()}/${id}.${file.type.split('/')[1]}`; blobs[image_path] = URL.createObjectURL(file); }
        db.listings.push({ id, seller_id: uid(), seller_display_name: me().display_name, status: 'published',
          created_at: new Date().toISOString(), image_path, ...fields });
        persist();
        return { id };
      },
      async signImages(paths) {
        await wait(80);
        if (!isActive()) return {}; // storage policy: active members only
        const out = {};
        paths.forEach((p) => {
          if (blobs[p]) { out[p] = blobs[p]; return; }
          const l = db.listings.find((x) => x.image_path === p);
          if (l) out[p] = art(l.id + l.title, l.category);
        });
        return out;
      },
    };

    // Developer helpers for the demo panel (an admin/service-role would do these).
    api.debug = {
      current: () => ({ session: clone(db.session), user: me() && { ...me(), password: undefined } }),
      async loginAs(email) { await api.auth.signIn(email, db.users.find((u) => u.email === email).password); },
      setStatus(status) {
        if (!me()) return;
        me().membership_status = status;
        persist();
        o.onLog(`admin: membership_status → ${status}`);
        if (w.MP) w.MP.refreshProfile();
      },
      useRecovery(token) {
        const id = recoveryTokens[token];
        if (!id) return false;
        delete recoveryTokens[token];
        db.session = makeSession(db.users.find((u) => u.id === id));
        fire('PASSWORD_RECOVERY');
        return true;
      },
      reset() { try { localStorage.removeItem(KEY); } catch { /* blocked */ } },
      // What each table/function returns for the *current* JWT — mirrors RLS.
      rlsReport() {
        const role = !uid() ? 'anon' : isActive() ? 'authenticated · active member' : `authenticated · ${me().membership_status}`;
        return {
          role,
          rows: [
            ['rpc get_listing_previews()', db.listings.filter((l) => l.status === 'published').length, 'teaser columns only'],
            ['select listings', uid() ? rowsFor().length : 0, isActive() ? 'published + own drafts' : uid() ? 'own listings only' : 'blocked by RLS'],
            ['select saved_listings', db.saved.filter((s) => s.user_id === uid()).length, uid() ? 'own rows only' : 'blocked by RLS'],
            ['storage listing-images', isActive() ? 'signed URLs' : 0, isActive() ? '1h expiry' : 'blocked by policy'],
            ['update profiles.membership_status', '✕', 'no column grant'],
          ],
        };
      },
    };
    return api;
  }

  w.MPMock = { create, CATEGORIES: CATS };
})(window);
