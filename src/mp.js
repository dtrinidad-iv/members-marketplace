/*! Members Marketplace for Squarespace — v1.0.0
 *  Vanilla JS, no build step. Requires @supabase/supabase-js v2 (UMD) unless a
 *  custom backend is supplied (the demo uses a mock with the same interface).
 *
 *  Usage: set window.MP_CONFIG before this script, then place
 *  <div data-mp="marketplace"></div> (or login, signup, saved, …) in any
 *  Squarespace Code Block.
 */
(function (w, d) {
  'use strict';
  if (w.MP && w.MP.version) return; // guard against double injection

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    supabaseUrl: '',
    supabaseAnonKey: '', // public anon key only — never the service_role key
    bucket: 'listing-images',
    pageSize: 12,
    currency: 'USD',
    categories: ['Furniture', 'Art & Prints', 'Ceramics', 'Textiles', 'Lighting', 'Services'],
    paths: {
      home: '/',
      login: '/login',
      signup: '/join',
      forgot: '/forgot-password',
      reset: '/reset-password',
      marketplace: '/marketplace',
      saved: '/saved',
      sell: '/sell',
      account: '/account',
    },
    protectedPaths: ['/saved', '/sell', '/account'],
    backend: null, // optional custom backend (demo/mock)
    router: null, // optional custom router (demo uses hash routing)
  };

  const userCfg = w.MP_CONFIG || {};
  const cfg = Object.assign({}, DEFAULTS, userCfg, {
    paths: Object.assign({}, DEFAULTS.paths, userCfg.paths),
  });

  // ---------------------------------------------------------------------------
  // Router (real page navigations on Squarespace; overridable for the demo)
  // ---------------------------------------------------------------------------
  const router = cfg.router || {
    path: () => location.pathname.replace(/\/+$/, '') || '/',
    query: () => new URLSearchParams(location.search),
    go: (url) => location.assign(url),
    setQuery(params) {
      const url = new URL(location.href);
      Object.entries(params).forEach(([k, v]) =>
        v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
      history.replaceState(history.state, '', url);
    },
  };

  // Only allow same-site relative redirects, and never back to an auth page.
  function safeNext(raw) {
    const p = cfg.paths;
    if (!raw || raw[0] !== '/' || raw.startsWith('//') || raw.includes('\\')) return p.marketplace;
    const path = raw.split(/[?#]/)[0];
    if ([p.login, p.signup, p.forgot, p.reset].includes(path)) return p.marketplace;
    return raw;
  }

  function withNext(path, next) {
    return next ? `${path}?next=${encodeURIComponent(next)}` : path;
  }

  function currentUrl() {
    const q = router.query().toString();
    return router.path() + (q ? `?${q}` : '');
  }

  // ---------------------------------------------------------------------------
  // Supabase backend (the only thing that talks to the network)
  // ---------------------------------------------------------------------------
  function createSupabaseBackend() {
    if (!w.supabase || !w.supabase.createClient) {
      throw new Error('[MP] supabase-js not loaded. Add it to Header Code Injection.');
    }
    const sb = w.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    const origin = location.origin;
    const must = ({ data, error }) => { if (error) throw error; return data; };
    const LISTING_COLS =
      'id,title,description,category,city,price_cents,contact_email,image_path,seller_id,seller_display_name,created_at';

    return {
      name: 'supabase',
      client: sb,
      auth: {
        onChange(cb) {
          const { data } = sb.auth.onAuthStateChange(cb);
          return () => data.subscription.unsubscribe();
        },
        async signIn(email, password) {
          must(await sb.auth.signInWithPassword({ email, password }));
        },
        async signUp(email, password, displayName) {
          return must(await sb.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: displayName },
              emailRedirectTo: origin + cfg.paths.login,
            },
          }));
        },
        async signOut() { must(await sb.auth.signOut()); },
        async sendReset(email) {
          must(await sb.auth.resetPasswordForEmail(email, { redirectTo: origin + cfg.paths.reset }));
        },
        async updatePassword(password) { must(await sb.auth.updateUser({ password })); },
      },
      async getProfile(uid) {
        return must(await sb.from('profiles')
          .select('id,display_name,membership_status,role').eq('id', uid).maybeSingle());
      },
      async listListings({ q, category, maxPrice, sort, page }) {
        const from = page * cfg.pageSize;
        let query = sb.from('listings')
          .select(LISTING_COLS, { count: 'exact' })
          .eq('status', 'published');
        if (q) query = query.textSearch('fts', q, { type: 'websearch', config: 'english' });
        if (category) query = query.eq('category', category);
        if (maxPrice) query = query.lte('price_cents', Math.round(maxPrice * 100));
        const [col, dir] = ({
          newest: ['created_at', false],
          price_asc: ['price_cents', true],
          price_desc: ['price_cents', false],
        })[sort] || ['created_at', false];
        query = query.order(col, { ascending: dir }).range(from, from + cfg.pageSize - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        return { rows: data, total: count || 0 };
      },
      async listPreviews({ category, limit }) {
        return must(await sb.rpc('get_listing_previews', { p_category: category || null, p_limit: limit }));
      },
      async getListing(id) {
        return must(await sb.from('listings').select(LISTING_COLS).eq('id', id).maybeSingle());
      },
      async savedIds() {
        return new Set(must(await sb.from('saved_listings').select('listing_id')).map((r) => r.listing_id));
      },
      async listSaved() {
        const rows = must(await sb.from('saved_listings')
          .select(`created_at, listing:listings(${LISTING_COLS})`)
          .order('created_at', { ascending: false }));
        return rows.map((r) => r.listing).filter(Boolean); // RLS may null out archived listings
      },
      async save(listingId) {
        const { error } = await sb.from('saved_listings').insert({ listing_id: listingId });
        if (error && error.code !== '23505') throw error; // already saved = fine
      },
      async unsave(listingId) {
        must(await sb.from('saved_listings').delete().eq('listing_id', listingId));
      },
      async createListing(uid, fields, file) {
        let image_path = null;
        if (file) {
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          image_path = `${uid}/${crypto.randomUUID()}.${ext}`; // folder = uid (enforced by storage policy)
          must(await sb.storage.from(cfg.bucket).upload(image_path, file, {
            cacheControl: '3600', upsert: false, contentType: file.type,
          }));
        }
        return must(await sb.from('listings').insert({ ...fields, image_path }).select('id').single());
      },
      async signImages(paths) {
        if (!paths.length) return {};
        const data = must(await sb.storage.from(cfg.bucket).createSignedUrls(paths, 3600));
        return Object.fromEntries(data.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
      },
    };
  }

  const api = cfg.backend || createSupabaseBackend();

  // ---------------------------------------------------------------------------
  // Auth state store
  // ---------------------------------------------------------------------------
  const state = { ready: false, event: null, session: null, user: null, profile: null };
  const listeners = new Set();
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  function emit() {
    const root = d.documentElement.classList;
    root.toggle('mp-auth-in', !!state.user);
    root.toggle('mp-auth-out', !state.user);
    root.toggle('mp-member-active', isActive());
    listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error('[MP]', e); } });
    d.dispatchEvent(new CustomEvent('mp:auth', { detail: { ...state } }));
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // Resolves once the store reflects a signed-in user (profile loaded), so a
  // redirect after login never lands on a guarded page before state catches up.
  function signedIn() {
    if (state.user) return Promise.resolve(state);
    return new Promise((resolve) => {
      const off = subscribe((s) => { if (s.user) { off(); resolve(s); } });
    });
  }
  function isActive() { return !!state.profile && state.profile.membership_status === 'active'; }

  let authSeq = 0;
  async function handleAuth(event, session) {
    const seq = ++authSeq;
    const user = session ? session.user : null;
    let profile = state.profile;
    if (!user) profile = null;
    else if (!profile || profile.id !== user.id || event === 'USER_UPDATED' || event === 'SIGNED_IN') {
      try { profile = await api.getProfile(user.id); } catch (e) { console.error('[MP] profile', e); profile = null; }
    }
    if (seq !== authSeq) return; // a newer auth event superseded this one
    Object.assign(state, { event, session, user, profile });
    if (!state.ready) { state.ready = true; resolveReady(state); }
    emit();
  }

  api.auth.onChange((event, session) => {
    // Never await Supabase calls inside onAuthStateChange — supabase-js holds a
    // lock during the callback, so we defer the work to the next tick.
    setTimeout(() => handleAuth(event, session), 0);
  });

  // Fallback so pages never hang if the auth event never arrives (offline etc.)
  setTimeout(() => { if (!state.ready) { state.ready = true; resolveReady(state); emit(); } }, 5000);

  async function refreshProfile() {
    if (!state.user) return;
    state.profile = await api.getProfile(state.user.id);
    emit();
  }

  // ---------------------------------------------------------------------------
  // Protected pages — redirect is UX; RLS is the actual security boundary.
  // ---------------------------------------------------------------------------
  const LOOP_KEY = 'mp_redirects';

  function isProtectedPath() {
    const p = router.path();
    return cfg.protectedPaths.some((x) => p === x || p.startsWith(`${x}/`)) ||
      !!d.querySelector('[data-mp="guard"]');
  }

  function tooManyRedirects() {
    try {
      const now = Date.now();
      const log = JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]').filter((t) => now - t < 10000);
      log.push(now);
      sessionStorage.setItem(LOOP_KEY, JSON.stringify(log));
      return log.length > 3;
    } catch { return false; }
  }

  function reveal() { d.documentElement.classList.remove('mp-pending'); }

  async function guard() {
    if (!isProtectedPath()) { reveal(); return; }
    await ready;
    if (state.user) { reveal(); return; }
    if (tooManyRedirects()) {
      // Something is misconfigured (e.g. login page listed as protected). Fail open
      // to a message instead of looping — data stays protected by RLS regardless.
      reveal();
      console.warn('[MP] redirect loop prevented');
      return;
    }
    router.go(withNext(cfg.paths.login, currentUrl()));
  }

  // Signing out on a protected page sends you to login once.
  subscribe((s) => {
    if (s.ready && !s.user && s.event === 'SIGNED_OUT' && isProtectedPath()) {
      router.go(cfg.paths.login);
    }
  });

  // ---------------------------------------------------------------------------
  // DOM helpers — all user data goes through textContent (no innerHTML = no XSS)
  // ---------------------------------------------------------------------------
  function h(tag, attrs, ...kids) {
    const el = d.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(Infinity).forEach((k) => {
      if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    });
    return el;
  }

  const ICON_PATHS = {
    heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.5h2c.7-1.4 2.2-2.5 4.3-2.5 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z',
    pin: 'M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    close: 'M6 6l12 12M18 6L6 18',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM21 21l-5-5',
  };
  function icon(name) {
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `mp-icon mp-icon-${name}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = d.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.append(path);
    return svg;
  }

  const money = (cents) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: cfg.currency, maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function link(text, path, cls) {
    return h('a', {
      class: cls || 'mp-link',
      href: path,
      onclick: cfg.router ? (e) => { e.preventDefault(); router.go(path); } : null,
    }, text);
  }

  function friendlyError(err) {
    const msg = (err && (err.message || err.error_description)) || 'Something went wrong.';
    if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox.';
    if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    return msg;
  }

  let toastHost;
  function toast(text, kind) {
    if (!toastHost) { toastHost = h('div', { class: 'mp mp-toasts', 'aria-live': 'polite' }); d.body.append(toastHost); }
    const t = h('div', { class: `mp-toast ${kind ? `mp-toast-${kind}` : ''}` }, text);
    toastHost.append(t);
    setTimeout(() => t.classList.add('mp-out'), 3200);
    setTimeout(() => t.remove(), 3600);
  }

  function categoryHue(cat) {
    let n = 0;
    for (const c of String(cat)) n = (n * 31 + c.charCodeAt(0)) % 360;
    return n;
  }

  function placeholder(cat, locked) {
    return h('div', { class: 'mp-ph', style: `--mp-hue:${categoryHue(cat)}` },
      locked ? icon('lock') : h('span', null, String(cat).slice(0, 1)));
  }

  // ---------------------------------------------------------------------------
  // Saved items (shared across components, optimistic with rollback)
  // ---------------------------------------------------------------------------
  const saved = { ids: new Set(), loadedFor: null, listeners: new Set() };

  async function loadSaved() {
    if (!state.user || !isActive()) { saved.ids = new Set(); saved.loadedFor = null; return saved.ids; }
    if (saved.loadedFor === state.user.id) return saved.ids;
    saved.ids = await api.savedIds();
    saved.loadedFor = state.user.id;
    return saved.ids;
  }

  async function toggleSave(id) {
    const was = saved.ids.has(id);
    was ? saved.ids.delete(id) : saved.ids.add(id);
    saved.listeners.forEach((fn) => fn(id));
    try {
      await (was ? api.unsave(id) : api.save(id));
      toast(was ? 'Removed from saved' : 'Saved to your list');
    } catch (e) {
      was ? saved.ids.add(id) : saved.ids.delete(id);
      saved.listeners.forEach((fn) => fn(id));
      toast(friendlyError(e), 'error');
    }
  }

  function saveButton(id, label) {
    const btn = h('button', {
      type: 'button',
      class: 'mp-save',
      onclick: (e) => { e.stopPropagation(); toggleSave(id); },
    }, icon('heart'), label ? h('span', { class: 'mp-save-label' }) : null);
    const sync = (changed) => {
      if (changed !== undefined && !btn.isConnected) { saved.listeners.delete(sync); return; }
      if (changed !== undefined && changed !== id) return;
      const on = saved.ids.has(id);
      btn.classList.toggle('mp-on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Remove from saved' : 'Save listing');
      const l = btn.querySelector('.mp-save-label');
      if (l) l.textContent = on ? 'Saved' : 'Save';
    };
    saved.listeners.add(sync);
    sync();
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Cards + detail dialog
  // ---------------------------------------------------------------------------
  function listingCard(item, imgUrl, onOpen) {
    return h('article', { class: 'mp-card' },
      h('button', { type: 'button', class: 'mp-card-hit', 'aria-label': `View ${item.title}`, onclick: () => onOpen(item) }),
      h('div', { class: 'mp-card-media' },
        imgUrl ? h('img', { src: imgUrl, alt: '', loading: 'lazy', decoding: 'async' }) : placeholder(item.category),
        saveButton(item.id)),
      h('div', { class: 'mp-card-body' },
        h('div', { class: 'mp-card-meta' }, h('span', { class: 'mp-chip' }, item.category),
          item.city ? h('span', { class: 'mp-muted' }, icon('pin'), item.city) : null),
        h('h3', { class: 'mp-card-title' }, item.title),
        h('div', { class: 'mp-card-foot' },
          h('strong', { class: 'mp-price' }, money(item.price_cents)),
          h('span', { class: 'mp-muted' }, item.seller_display_name))));
  }

  function previewCard(item, onGate) {
    return h('article', { class: 'mp-card mp-card-locked' },
      h('button', { type: 'button', class: 'mp-card-hit', 'aria-label': `${item.title} — members only`, onclick: onGate }),
      h('div', { class: 'mp-card-media' }, placeholder(item.category, true)),
      h('div', { class: 'mp-card-body' },
        h('div', { class: 'mp-card-meta' }, h('span', { class: 'mp-chip' }, item.category),
          item.city ? h('span', { class: 'mp-muted' }, icon('pin'), item.city) : null),
        h('h3', { class: 'mp-card-title' }, item.title),
        h('div', { class: 'mp-card-foot' },
          h('span', { class: 'mp-blur', 'aria-hidden': 'true' }, '$•••'),
          h('span', { class: 'mp-muted' }, 'Members only'))));
  }

  function openDialog(build) {
    const dlg = h('dialog', { class: 'mp mp-dialog' });
    const close = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // backdrop click
    dlg.addEventListener('close', () => dlg.remove());
    dlg.append(h('button', { type: 'button', class: 'mp-dialog-x', 'aria-label': 'Close', onclick: close }, icon('close')));
    dlg.append(build(close));
    d.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  async function openListing(id, onClose) {
    const body = h('div', { class: 'mp-detail' }, h('div', { class: 'mp-skeleton mp-skeleton-hero' }));
    const dlg = openDialog(() => body);
    if (onClose) dlg.addEventListener('close', onClose);
    try {
      const item = await api.getListing(id);
      if (!item) { body.replaceChildren(h('p', { class: 'mp-empty' }, 'This listing is no longer available.')); return; }
      const urls = item.image_path ? await api.signImages([item.image_path]) : {};
      const img = urls[item.image_path];
      body.replaceChildren(
        h('div', { class: 'mp-detail-media' }, img ? h('img', { src: img, alt: item.title }) : placeholder(item.category)),
        h('div', { class: 'mp-detail-body' },
          h('div', { class: 'mp-card-meta' }, h('span', { class: 'mp-chip' }, item.category),
            item.city ? h('span', { class: 'mp-muted' }, icon('pin'), item.city) : null),
          h('h2', { class: 'mp-detail-title' }, item.title),
          h('p', { class: 'mp-price mp-price-lg' }, money(item.price_cents)),
          h('p', { class: 'mp-detail-desc' }, item.description),
          h('p', { class: 'mp-muted' }, `Listed by ${item.seller_display_name || 'a member'} · `,
            new Date(item.created_at).toLocaleDateString()),
          h('div', { class: 'mp-actions' },
            item.contact_email
              ? h('a', { class: 'mp-btn', href: `mailto:${item.contact_email}?subject=${encodeURIComponent(`Re: ${item.title}`)}` }, 'Contact seller')
              : null,
            saveButton(item.id, true)),
          item.contact_email ? h('p', { class: 'mp-muted mp-contact' }, item.contact_email) : null));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'mp-error' }, friendlyError(e)));
    }
  }

  function gatePrompt(kind) {
    const next = currentUrl();
    if (kind === 'pending') {
      return h('div', { class: 'mp-gate' },
        h('div', { class: 'mp-gate-icon' }, icon('lock')),
        h('div', null,
          h('strong', null, 'Your membership is pending approval'),
          h('p', null, 'You’re signed in. Full listings, prices and seller contacts unlock as soon as your membership is activated.')));
    }
    return h('div', { class: 'mp-gate' },
      h('div', { class: 'mp-gate-icon' }, icon('lock')),
      h('div', null,
        h('strong', null, 'This marketplace is for members'),
        h('p', null, 'Join to see prices, photos and seller contact details, and to save listings.')),
      h('div', { class: 'mp-actions' },
        link('Join now', withNext(cfg.paths.signup, next), 'mp-btn'),
        link('Log in', withNext(cfg.paths.login, next), 'mp-btn mp-btn-ghost')));
  }

  // ---------------------------------------------------------------------------
  // Components — <div data-mp="name" data-…></div>
  // ---------------------------------------------------------------------------
  const components = {};

  components.marketplace = (el) => {
    const limit = parseInt(el.dataset.limit, 10) || 0; // data-limit="4" = compact teaser (no filters)
    const showFilters = !limit && el.dataset.filters !== 'false';
    const q0 = router.query();
    const f = {
      q: q0.get('q') || '',
      category: q0.get('category') || el.dataset.category || '',
      maxPrice: q0.get('max') || '',
      sort: q0.get('sort') || 'newest',
      page: 0,
    };
    let lastMode = null;
    let reqId = 0;

    const gate = h('div', { class: 'mp-gate-slot' });
    const grid = h('div', { class: 'mp-grid', 'aria-live': 'polite' });
    const status = h('p', { class: 'mp-muted mp-count' });
    const more = h('button', { type: 'button', class: 'mp-btn mp-btn-ghost mp-more', hidden: true,
      onclick: () => { f.page += 1; load(true); } }, 'Load more');

    const search = h('input', { type: 'search', class: 'mp-input', placeholder: 'Search listings…', value: f.q,
      'aria-label': 'Search listings', oninput: debounce((e) => { f.q = e.target.value.trim(); refilter(); }, 300) });
    const catSel = h('select', { class: 'mp-input', 'aria-label': 'Category', onchange: (e) => { f.category = e.target.value; refilter(); } },
      h('option', { value: '' }, 'All categories'),
      cfg.categories.map((c) => h('option', { value: c, selected: c === f.category }, c)));
    const maxIn = h('input', { type: 'number', min: '0', step: '10', class: 'mp-input mp-input-sm', placeholder: 'Max $',
      'aria-label': 'Maximum price', value: f.maxPrice,
      oninput: debounce((e) => { f.maxPrice = e.target.value; refilter(); }, 400) });
    const sortSel = h('select', { class: 'mp-input', 'aria-label': 'Sort', onchange: (e) => { f.sort = e.target.value; refilter(); } },
      [['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']]
        .map(([v, t]) => h('option', { value: v, selected: v === f.sort }, t)));
    const filters = h('div', { class: 'mp-filters' },
      h('label', { class: 'mp-search' }, icon('search'), search), catSel, maxIn, sortSel);

    el.replaceChildren(h('div', { class: 'mp mp-market' },
      limit ? [grid, gate] : [gate, showFilters ? filters : null, status, grid, more]));

    function mode() { return !state.user ? 'anon' : isActive() ? 'member' : 'pending'; }

    function refilter() {
      f.page = 0;
      if (showFilters) router.setQuery({ q: f.q, category: f.category, max: f.maxPrice, sort: f.sort === 'newest' ? '' : f.sort });
      load(false);
    }

    function skeletons(n) {
      return Array.from({ length: n }, () => h('div', { class: 'mp-card mp-skeleton-card' },
        h('div', { class: 'mp-skeleton mp-skeleton-media' }), h('div', { class: 'mp-skeleton mp-skeleton-line' }),
        h('div', { class: 'mp-skeleton mp-skeleton-line mp-short' })));
    }

    function openFromCard(item) {
      router.setQuery({ listing: item.id });
      openListing(item.id, () => router.setQuery({ listing: '' }));
    }

    const showGateDialog = () => openDialog(() => gatePrompt(mode()));

    async function load(append) {
      const id = ++reqId;
      const m = mode();
      filters.hidden = m !== 'member';
      if (!append) { grid.replaceChildren(...skeletons(limit || 6)); more.hidden = true; status.textContent = ''; }
      gate.replaceChildren(m === 'member' ? '' : gatePrompt(m));
      try {
        if (m !== 'member') {
          const rows = await api.listPreviews({ category: f.category, limit: limit || 12 });
          if (id !== reqId) return;
          grid.replaceChildren(...rows.map((r) => previewCard(r, showGateDialog)));
          return;
        }
        const [{ rows, total }] = await Promise.all([
          api.listListings({ ...f, maxPrice: parseFloat(f.maxPrice) || 0, page: f.page }),
          loadSaved(),
        ]);
        const shown = limit ? rows.slice(0, limit) : rows;
        const urls = await api.signImages(shown.map((r) => r.image_path).filter(Boolean));
        if (id !== reqId) return;
        const cards = shown.map((r) => listingCard(r, urls[r.image_path], openFromCard));
        if (append) grid.append(...cards); else grid.replaceChildren(...cards);
        if (!total) grid.replaceChildren(h('p', { class: 'mp-empty' }, 'No listings match those filters.'));
        const count = grid.querySelectorAll('.mp-card').length;
        if (!limit) status.textContent = total ? `${total} listing${total === 1 ? '' : 's'}` : '';
        more.hidden = !!limit || count >= total;
      } catch (e) {
        if (id === reqId) grid.replaceChildren(h('p', { class: 'mp-error' }, friendlyError(e)));
      }
    }

    const unsub = subscribe(() => {
      if (!el.isConnected) { unsub(); return; }
      const m = mode();
      if (m !== lastMode) { lastMode = m; f.page = 0; load(false); }
    });
    ready.then(() => {
      lastMode = mode();
      load(false);
      const deep = router.query().get('listing'); // shareable deep link
      if (deep && lastMode === 'member' && !limit) openListing(deep, () => router.setQuery({ listing: '' }));
    });
  };

  components.saved = (el) => {
    const grid = h('div', { class: 'mp-grid' });
    el.replaceChildren(h('div', { class: 'mp mp-market' }, grid));
    async function load() {
      if (!state.user) return;
      if (!isActive()) { grid.replaceChildren(gatePrompt('pending')); return; }
      grid.replaceChildren(h('div', { class: 'mp-skeleton mp-skeleton-line' }));
      try {
        const [rows] = await Promise.all([api.listSaved(), loadSaved()]);
        const urls = await api.signImages(rows.map((r) => r.image_path).filter(Boolean));
        if (!rows.length) {
          grid.replaceChildren(h('div', { class: 'mp-empty' }, 'Nothing saved yet. ',
            link('Browse the marketplace', cfg.paths.marketplace)));
          return;
        }
        grid.replaceChildren(...rows.map((r) => listingCard(r, urls[r.image_path], (item) => openListing(item.id, load))));
      } catch (e) { grid.replaceChildren(h('p', { class: 'mp-error' }, friendlyError(e))); }
    }
    let lastKey;
    const key = () => `${state.user && state.user.id}:${isActive()}`;
    const unsub = subscribe(() => {
      if (!el.isConnected) { unsub(); return; }
      if (key() !== lastKey) { lastKey = key(); load(); }
    });
    ready.then(() => { lastKey = key(); load(); });
  };

  function authForm({ title, intro, fields, submit, footer, onSubmit }) {
    const err = h('p', { class: 'mp-error', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'mp-btn mp-btn-block' }, submit);
    const form = h('form', { class: 'mp mp-auth', novalidate: true },
      h('h2', { class: 'mp-auth-title' }, title),
      intro ? h('p', { class: 'mp-muted' }, intro) : null,
      fields.map((fd) => h('label', { class: 'mp-field' }, h('span', null, fd.label),
        h('input', { class: 'mp-input', required: true, ...fd.attrs }))),
      err, btn, footer ? h('div', { class: 'mp-auth-foot' }, footer) : null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Please wait…';
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); }
      catch (ex) { err.textContent = friendlyError(ex); err.hidden = false; }
      finally { btn.disabled = false; btn.textContent = label; }
    });
    return form;
  }

  components.login = (el) => {
    const next = safeNext(router.query().get('next'));
    ready.then(() => { if (state.user) router.go(next); }); // already signed in → no form, no loop
    el.replaceChildren(authForm({
      title: 'Member log in',
      fields: [
        { label: 'Email', attrs: { name: 'email', type: 'email', autocomplete: 'email' } },
        { label: 'Password', attrs: { name: 'password', type: 'password', autocomplete: 'current-password' } },
      ],
      submit: 'Log in',
      footer: [link('Forgot password?', cfg.paths.forgot), h('span', null, ' · New here? '),
        link('Join', withNext(cfg.paths.signup, router.query().get('next')))],
      async onSubmit({ email, password }) {
        await api.auth.signIn(email.trim(), password);
        await signedIn();
        try { sessionStorage.removeItem(LOOP_KEY); } catch { /* storage blocked */ }
        router.go(next);
      },
    }));
  };

  components.signup = (el) => {
    ready.then(() => { if (state.user) router.go(safeNext(router.query().get('next'))); });
    el.replaceChildren(authForm({
      title: 'Become a member',
      intro: 'Create your account. Membership is activated after review.',
      fields: [
        { label: 'Name', attrs: { name: 'name', type: 'text', autocomplete: 'name', maxlength: '80' } },
        { label: 'Email', attrs: { name: 'email', type: 'email', autocomplete: 'email' } },
        { label: 'Password', attrs: { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8' } },
      ],
      submit: 'Create account',
      footer: [h('span', null, 'Already a member? '), link('Log in', withNext(cfg.paths.login, router.query().get('next')))],
      async onSubmit({ name, email, password }, form) {
        const res = await api.auth.signUp(email.trim(), password, name.trim());
        if (res && res.session) { await signedIn(); router.go(safeNext(router.query().get('next'))); return; }
        form.replaceChildren(h('h2', { class: 'mp-auth-title' }, 'Check your email'),
          h('p', null, `We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`));
      },
    }));
  };

  components.forgot = (el) => {
    el.replaceChildren(authForm({
      title: 'Reset your password',
      intro: 'Enter your email and we’ll send you a reset link.',
      fields: [{ label: 'Email', attrs: { name: 'email', type: 'email', autocomplete: 'email' } }],
      submit: 'Send reset link',
      footer: [link('Back to log in', cfg.paths.login)],
      async onSubmit({ email }, form) {
        await api.auth.sendReset(email.trim());
        // Same message whether or not the account exists — no account enumeration.
        form.replaceChildren(h('h2', { class: 'mp-auth-title' }, 'Check your inbox'),
          h('p', null, 'If an account exists for that email, a reset link is on its way.'),
          link('Back to log in', cfg.paths.login));
      },
    }));
  };

  components.reset = (el) => {
    const waiting = h('p', { class: 'mp-muted mp mp-auth' }, 'Verifying your reset link…');
    el.replaceChildren(waiting);
    const show = () => el.replaceChildren(authForm({
      title: 'Choose a new password',
      fields: [{ label: 'New password', attrs: { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8' } }],
      submit: 'Update password',
      async onSubmit({ password }) {
        await api.auth.updatePassword(password);
        toast('Password updated', 'ok');
        router.go(cfg.paths.marketplace);
      },
    }));
    // supabase-js exchanges the link's code and fires PASSWORD_RECOVERY.
    const unsub = subscribe((s) => {
      if (!el.isConnected) { unsub(); return; }
      if (s.event === 'PASSWORD_RECOVERY') { unsub(); show(); }
    });
    ready.then((s) => {
      if (s.event === 'PASSWORD_RECOVERY' || s.user) { unsub(); show(); return; }
      setTimeout(() => {
        if (!state.user && el.contains(waiting)) {
          waiting.replaceChildren('This reset link is invalid or has expired. ', link('Request a new one', cfg.paths.forgot));
        }
      }, 3000);
    });
  };

  components.account = (el) => {
    const box = h('div', { class: 'mp mp-account' });
    el.replaceChildren(box);
    const render = () => {
      if (!el.isConnected) { unsub(); return; }
      if (!state.user) { box.replaceChildren(); return; }
      const p = state.profile || {};
      const st = p.membership_status || 'pending';
      box.replaceChildren(
        h('div', { class: 'mp-account-head' },
          h('div', null, h('h2', { class: 'mp-auth-title' }, p.display_name || 'Your account'),
            h('p', { class: 'mp-muted' }, state.user.email)),
          h('span', { class: `mp-badge mp-badge-${st}` }, st)),
        authForm({
          title: 'Change password',
          fields: [{ label: 'New password', attrs: { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8' } }],
          submit: 'Update password',
          async onSubmit({ password }, form) { await api.auth.updatePassword(password); form.reset(); toast('Password updated', 'ok'); },
        }),
        h('button', { type: 'button', class: 'mp-btn mp-btn-ghost', onclick: () => api.auth.signOut() }, 'Log out'));
    };
    const unsub = subscribe(render);
    ready.then(render);
  };

  components.sell = (el) => {
    const box = h('div', { class: 'mp' });
    el.replaceChildren(box);
    const render = () => {
      if (!el.isConnected) { unsub(); return; }
      if (!state.user) return;
      if (!isActive()) { box.replaceChildren(gatePrompt('pending')); return; }
      const preview = h('div', { class: 'mp-upload-preview' }, placeholder('+'));
      const form = authForm({
        title: 'Post a listing',
        fields: [
          { label: 'Title', attrs: { name: 'title', type: 'text', minlength: '3', maxlength: '120' } },
          { label: 'City', attrs: { name: 'city', type: 'text', maxlength: '60' } },
          { label: 'Price (USD)', attrs: { name: 'price', type: 'number', min: '0', step: '1' } },
          { label: 'Contact email', attrs: { name: 'contact_email', type: 'email', value: state.user.email } },
        ],
        submit: 'Publish listing',
        async onSubmit(data, f) {
          const file = f.querySelector('[name="image"]').files[0];
          if (file && (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024)) {
            throw new Error('Images must be JPG, PNG or WebP and under 5 MB.');
          }
          await api.createListing(state.user.id, {
            title: data.title.trim(),
            description: data.description.trim(),
            category: data.category,
            city: data.city.trim(),
            price_cents: Math.round(parseFloat(data.price) * 100),
            contact_email: data.contact_email.trim(),
          }, file);
          toast('Listing published', 'ok');
          router.go(cfg.paths.marketplace);
        },
      });
      // Extra fields that aren't plain inputs.
      const anchor = form.querySelector('.mp-error');
      anchor.before(
        h('label', { class: 'mp-field' }, h('span', null, 'Category'),
          h('select', { class: 'mp-input', name: 'category', required: true }, cfg.categories.map((c) => h('option', { value: c }, c)))),
        h('label', { class: 'mp-field' }, h('span', null, 'Description'),
          h('textarea', { class: 'mp-input', name: 'description', rows: '4', maxlength: '4000' })),
        h('label', { class: 'mp-field' }, h('span', null, 'Photo (optional)'),
          h('div', { class: 'mp-upload' }, preview,
            h('input', { type: 'file', name: 'image', accept: 'image/jpeg,image/png,image/webp', onchange: (e) => {
              const file = e.target.files[0];
              preview.replaceChildren(file ? h('img', { src: URL.createObjectURL(file), alt: '' }) : placeholder('+'));
            } }))));
      form.classList.add('mp-sell');
      box.replaceChildren(form);
    };
    let lastKey;
    const unsub = subscribe(() => {
      const key = `${state.user && state.user.id}:${isActive()}`;
      if (key !== lastKey) { lastKey = key; render(); }
    });
    ready.then(() => { lastKey = `${state.user && state.user.id}:${isActive()}`; render(); });
  };

  // Auth-aware nav. Also usable as pure CSS: html.mp-auth-in / .mp-auth-out / .mp-member-active
  components['auth-nav'] = (el) => {
    const render = () => {
      if (!el.isConnected) { unsub(); return; }
      el.replaceChildren(h('nav', { class: 'mp mp-nav' }, state.user
        ? [link('Saved', cfg.paths.saved), link('Account', cfg.paths.account),
          h('button', { type: 'button', class: 'mp-link', onclick: () => api.auth.signOut() }, 'Log out')]
        : [link('Log in', withNext(cfg.paths.login, currentUrl())), link('Join', cfg.paths.signup, 'mp-btn mp-btn-sm')]));
    };
    const unsub = subscribe(render);
    ready.then(render);
  };

  components.guard = () => {}; // marker only; see guard()

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  function mount(root) {
    (root || d).querySelectorAll('[data-mp]').forEach((el) => {
      if (el.__mpMounted) return;
      const c = components[el.dataset.mp];
      if (!c) { console.warn('[MP] unknown component', el.dataset.mp); return; }
      el.__mpMounted = true;
      try { c(el); } catch (e) { console.error('[MP]', el.dataset.mp, e); }
    });
    guard();
  }

  w.MP = {
    version: '1.0.0',
    config: cfg,
    api,
    state,
    ready,
    subscribe,
    mount,
    refreshProfile,
    toast,
    components, // extension point: MP.components.myThing = (el) => {}
  };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => mount());
  else mount();
  // Squarespace 7.0 templates with AJAX page loading fire this on navigation.
  w.addEventListener('mercury:load', () => mount());
})(window, document);
