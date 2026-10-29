/*
 * Emploitic – tri par date de publication
 * Ajoute un sélecteur « Trier par date » au-dessus de la liste des offres.
 * Deux portées : la page affichée, ou toutes les pages via les endpoints internes.
 * SPDX-License-Identifier: GPL-3.0-only
 */
(() => {
  'use strict';

  if (!/(^|\.)emploitic\.com$/i.test(location.hostname)) return;

  const LIST_SELECTOR = '[data-testid="jobs-list"]';
  const ITEM_SELECTOR = ':scope > li[data-testid="jobs-item"]';
  const TOOLBAR_ID = 'empl-sort-toolbar';
  const SELECT_ID = 'empl-sort-select';
  const STATUS_ID = 'empl-sort-status';
  const GLOBAL_ID = 'empl-global-view';
  const MODE_KEY = 'emploitic-sort-mode';
  const CACHE_TTL = 60 * 1000;
  const PAGE_SIZE = 20;
  const API_PATH = '/api/v4/jobboard/jobs/search';
  const LOGO_PROXY_WIDTH = 128;
  const EMPTY_LOGO_PATH = '/images/comany_empty_logo.png';
  const SECTOR_IMAGES = {
    'f38cfe2e2facbcc742bad63f91ad55637300cb45': '/images/sectors/informatique.jpg',
    '0ca9277f91e40054767f69afeb0426711ca0fddd': '/images/sectors/finance.jpg',
    '114d4eefde1dae3983e7a79f04c72feb9a3a7efd': '/images/sectors/immobilier.jpg',
    '008451a05e1e7aa32c75119df950d405265e0904': '/images/sectors/commerce.jpg',
    'b4182bff4b3cf75f9e54f4990f9bd153c0c2973c': '/images/sectors/industries.jpg',
    '8b7471f4ae0bf59f5f0a425068c05d96f4801b9e': '/images/sectors/services.jpg',
    'f47aea8bdcbd1179a1f3d91e6afeeb259488f2d1': '/images/sectors/services.jpg',
    'be057d4ca44c10a0fc1dfcffd99cce1490291dc7': '/images/sectors/energie.jpg'
  };

  const MODES = ['default', 'newest', 'oldest', 'newest-all', 'oldest-all'];
  const MONTHS = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
  ];

  const RE_TODAY = /^aujourd'?hui$/;
  const RE_YESTERDAY = /^hier$/;
  const RE_AGO = /^il y a (\d+) (minute|heure|jour|semaine|mois|an|annee)s?$/;
  const RE_DAY_MONTH = /^(\d{1,2})(?:er)? ([a-z]+)\.?(?: (\d{4}))?$/;
  const RE_NUMERIC = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/;
  const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

  let mode = 'default';
  let applying = false;
  let applyTimer = 0;
  let fetchSeq = 0;
  let lastHref = location.href;
  let dataCache = { url: '', at: 0, map: new Map() };
  let embeddedCache = null;
  let buildIdCache = '';
  const origIndex = new WeakMap();
  let origSeq = 0;

  const globalState = {
    page: 1,
    offers: [],
    total: 0,
    totalPages: 0,
    loading: false,
    error: '',
    version: 0,
    reqSeq: 0,
    template: null,
    hrTemplate: null,
    suspended: false
  };

  const dateFormatter = (() => {
    try {
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    } catch (e) {
      return null;
    }
  })();

  function isGlobalMode(value) {
    return value === 'newest-all' || value === 'oldest-all';
  }

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  function fold(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function listEl() {
    return document.querySelector(LIST_SELECTOR);
  }

  function itemsOf(list) {
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll(ITEM_SELECTOR));
  }

  function aliasOf(item) {
    const link = item.querySelector('a[href]');
    if (!link) return '';
    const href = (link.getAttribute('href') || '').split('#')[0].split('?')[0].replace(/\/+$/, '');
    const alias = href.slice(href.lastIndexOf('/') + 1);
    try {
      return decodeURIComponent(alias);
    } catch (e) {
      return alias;
    }
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    try {
      return n.toLocaleString('fr-FR');
    } catch (e) {
      return String(n);
    }
  }

  function firstLabel(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const label = firstLabel(value[i]);
        if (label) return label;
      }
      return '';
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.label ? String(value.label) : '';
    return String(value);
  }

  function firstValue(value) {
    if (Array.isArray(value)) return value.length ? value[0] : '';
    return value == null ? '' : value;
  }

  function slugifyLabel(value) {
    return fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function companyName(offer) {
    if (!offer || offer.isAnonymous) return 'Entreprise anonyme';
    const name = offer.company && offer.company.name ? String(offer.company.name).trim() : '';
    return name || 'Entreprise anonyme';
  }

  function logoLetter(offer) {
    const name = companyName(offer);
    const sector = firstLabel(offer && offer.company && offer.company.sector);
    const source = name === 'Entreprise anonyme' ? (sector || 'E') : name;
    const letter = String(source || 'E').trim().charAt(0).toUpperCase();
    return letter || 'E';
  }

  function proxiedImage(path) {
    return '/_next/image?url=' + encodeURIComponent(path) + '&w=' + LOGO_PROXY_WIDTH + '&q=75';
  }

  function sectorImagePath(offer) {
    const sector = offer && offer.company && offer.company.sector;
    const id = sector && sector.id ? String(sector.id) : '';
    return id && SECTOR_IMAGES[id] ? SECTOR_IMAGES[id] : '';
  }

  function companyLogoPaths(offer) {
    const paths = [];
    if (offer && !offer.isAnonymous) {
      const company = offer.company || {};
      const raw = company.logo || company.logoUrl || company.logoURL || '';
      const value = String(raw || '').trim();
      if (value) {
        if (/^https?:\/\//i.test(value)) {
          paths.push(value);
        } else if (value.charAt(0) === '/') {
          paths.push(value);
        } else if (/^arn:local:oss:emploitic:/i.test(value)) {
          paths.push('https://recruiter.emploitic.com/api/v2/photo/logo/' + encodeURIComponent(value));
        } else {
          paths.push('https://emploitic.com/images/logos/' + encodeURIComponent(value));
        }
      }
    }
    const sector = sectorImagePath(offer);
    if (sector) paths.push(sector);
    paths.push(EMPTY_LOGO_PATH);
    return Array.from(new Set(paths));
  }

  function offerUrl(offer) {
    if (!offer) return '/offres-d-emploi';
    const alias = offer.alias ? String(offer.alias) : '';
    const sector = offer.company && offer.company.sector ? firstLabel(offer.company.sector) : '';
    const sectorSlug = sector ? slugifyLabel(sector) : '';
    const companyAlias = offer.company && offer.company.alias && !offer.isAnonymous
      ? String(offer.company.alias)
      : '';

    const parts = [];
    if (companyAlias) {
      parts.push('/entreprises', encodeURIComponent(companyAlias), 'offres-d-emploi');
    } else {
      parts.push('/offres-d-emploi');
    }
    if (sectorSlug) parts.push(sectorSlug);
    if (alias) parts.push(encodeURIComponent(alias));
    return parts.join('/');
  }

  function placeText(offer) {
    if (!offer) return 'Lieu non précisé';
    const location = firstLabel(offer.location);
    const workMode = String(firstValue(offer.workMode) || '').toLowerCase();
    if (workMode === 'remote') return 'Télétravail';
    if (workMode === 'hybrid') return location ? location + ' (Hybride)' : 'Hybride';
    return location || 'Lieu non précisé';
  }

  function levelText(offer) {
    if (!offer) return '';
    const level = firstLabel(offer.jobLevel);
    const experience = firstLabel(offer.experienceYears);
    if (level && experience) return level + ' (' + experience + ')';
    return level || experience || '';
  }

  function relativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((today.getTime() - day.getTime()) / 86400000);

    if (days <= 0) return "Aujourd'hui";
    if (days === 1) return 'Hier';
    if (days < 7) return 'Il y a ' + days + ' jours';

    const options = { day: 'numeric', month: 'long' };
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    try {
      return new Intl.DateTimeFormat('fr-FR', options).format(date);
    } catch (e) {
      return date.toLocaleDateString();
    }
  }

  function stripHtml(html) {
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      Array.prototype.slice.call(doc.querySelectorAll('script,style,noscript')).forEach((el) => el.remove());
      const text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
      if (text.length <= 220) return text;
      return text.slice(0, 220).replace(/\s+\S*$/, '') + '…';
    } catch (e) {
      return '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lecture / analyse des dates                                         */
  /* ------------------------------------------------------------------ */

  function mapFromOffers(offers) {
    const map = new Map();
    if (!Array.isArray(offers)) return map;
    offers.forEach((offer) => {
      if (!offer) return;
      const ts = Date.parse(offer.publishedAt);
      if (Number.isNaN(ts)) return;
      if (offer.alias) map.set(String(offer.alias), ts);
      if (offer.id) map.set('id:' + offer.id, ts);
    });
    return map;
  }

  function embeddedMap() {
    if (embeddedCache) return embeddedCache;
    const node = document.getElementById('__NEXT_DATA__');
    if (!node) return new Map();
    try {
      const json = JSON.parse(node.textContent);
      embeddedCache = mapFromOffers(json && json.props && json.props.pageProps &&
        json.props.pageProps.searchResult && json.props.pageProps.searchResult.data);
      return embeddedCache;
    } catch (e) {
      return new Map();
    }
  }

  function isDateText(text) {
    return RE_TODAY.test(text) || RE_YESTERDAY.test(text) || RE_AGO.test(text) ||
      RE_DAY_MONTH.test(text) || RE_NUMERIC.test(text) || RE_ISO.test(text);
  }

  function findDateEl(item) {
    if (!item) return null;
    const divs = item.querySelectorAll('div');
    for (let i = 0; i < divs.length; i += 1) {
      const text = fold(divs[i].textContent);
      if (text.length > 0 && text.length <= 32 && isDateText(text)) return divs[i];
    }
    return null;
  }

  function dateTextOf(item) {
    const el = findDateEl(item);
    return el ? el.textContent : '';
  }

  function inferYear(monthIndex, now) {
    return monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
  }

  function parseDateText(raw) {
    const text = fold(raw);
    if (!text) return null;
    const now = new Date();

    if (RE_TODAY.test(text)) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    }
    if (RE_YESTERDAY.test(text)) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
    }

    let match = text.match(RE_AGO);
    if (match) {
      const amount = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === 'minute') return now.getTime() - amount * 60 * 1000;
      if (unit === 'heure') return now.getTime() - amount * 60 * 60 * 1000;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
      if (unit === 'jour') d.setDate(d.getDate() - amount);
      else if (unit === 'semaine') d.setDate(d.getDate() - 7 * amount);
      else if (unit === 'mois') d.setMonth(d.getMonth() - amount);
      else d.setFullYear(d.getFullYear() - amount);
      return d.getTime();
    }

    match = text.match(RE_DAY_MONTH);
    if (match) {
      const day = parseInt(match[1], 10);
      let monthIndex = MONTHS.indexOf(match[2]);
      if (monthIndex < 0 && match[2].length >= 3) {
        monthIndex = MONTHS.findIndex((month) => month.indexOf(match[2]) === 0);
      }
      if (monthIndex >= 0 && day >= 1 && day <= 31) {
        const year = match[3] ? parseInt(match[3], 10) : inferYear(monthIndex, now);
        return new Date(year, monthIndex, day, 12).getTime();
      }
    }

    match = text.match(RE_NUMERIC);
    if (match) {
      return new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10), 12).getTime();
    }

    match = text.match(RE_ISO);
    if (match) {
      return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 12).getTime();
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Récupération des dates exactes (données Next.js de la page)         */
  /* ------------------------------------------------------------------ */

  function buildIdOfDocument() {
    if (buildIdCache) return buildIdCache;
    try {
      const json = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
      buildIdCache = json && json.buildId ? json.buildId : '';
      return buildIdCache;
    } catch (e) {
      return '';
    }
  }

  async function fetchDates(url) {
    const parsed = new URL(url);
    const buildId = buildIdOfDocument();

    if (buildId && parsed.origin === location.origin) {
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      const query = parsed.searchParams.toString();
      const dataUrl = parsed.origin + '/_next/data/' + buildId + path + '.json' + (query ? '?' + query : '');
      try {
        const response = await fetch(dataUrl, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' }
        });
        if (response.ok) {
          const json = await response.json();
          const map = mapFromOffers(json && json.pageProps && json.pageProps.searchResult &&
            json.pageProps.searchResult.data);
          if (map.size) return map;
        }
      } catch (e) {
        /* on retombe sur le HTML */
      }
    }

    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const node = doc.getElementById('__NEXT_DATA__');
    if (!node) return new Map();
    try {
      const json = JSON.parse(node.textContent);
      return mapFromOffers(json && json.props && json.props.pageProps &&
        json.props.pageProps.searchResult && json.props.pageProps.searchResult.data);
    } catch (e) {
      return new Map();
    }
  }

  function freshMap() {
    if (dataCache.url !== location.href) return new Map();
    if (Date.now() - dataCache.at > CACHE_TTL) return new Map();
    return dataCache.map;
  }

  async function refreshDates() {
    if (mode === 'default' || isGlobalMode(mode)) return;
    const url = location.href;

    if (dataCache.url === url && Date.now() - dataCache.at < CACHE_TTL) {
      applyNow();
      return;
    }

    const seq = ++fetchSeq;
    setStatusText('Chargement des dates…');
    try {
      const map = await fetchDates(url);
      if (seq !== fetchSeq || url !== location.href || mode === 'default' || isGlobalMode(mode)) return;
      dataCache = { url: url, at: Date.now(), map: map };
      applyNow();
    } catch (e) {
      if (seq === fetchSeq && url === location.href) applyNow();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tri et réordonnancement du DOM (page affichée)                      */
  /* ------------------------------------------------------------------ */

  function buildEntries(list) {
    const embedded = embeddedMap();
    const fresh = freshMap();

    return itemsOf(list).map((el) => {
      if (!origIndex.has(el)) origIndex.set(el, origSeq++);
      const alias = aliasOf(el);
      let ts = null;
      let exact = false;

      if (alias && fresh.has(alias)) {
        ts = fresh.get(alias);
        exact = true;
      } else if (alias && embedded.has(alias)) {
        ts = embedded.get(alias);
        exact = true;
      }

      if (ts == null) ts = parseDateText(dateTextOf(el));

      return { el: el, alias: alias, ts: ts, exact: exact, orig: origIndex.get(el) };
    });
  }

  function sortEntries(entries) {
    const sorted = entries.slice();
    if (mode === 'default') {
      sorted.sort((a, b) => a.orig - b.orig);
      return sorted;
    }
    const missing = mode === 'newest' ? -Infinity : Infinity;
    sorted.sort((a, b) => {
      const av = a.ts == null ? missing : a.ts;
      const bv = b.ts == null ? missing : b.ts;
      if (av === bv) return a.orig - b.orig;
      return mode === 'newest' ? bv - av : av - bv;
    });
    return sorted;
  }

  function sameOrder(list, ordered) {
    const current = itemsOf(list);
    if (current.length !== ordered.length) return false;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== ordered[i]) return false;
    }
    return true;
  }

  /*
   * Replace les <li> dans l'ordre demandé sans déplacer les séparateurs <hr> :
   * chaque <li> est réinséré à l'emplacement de l'ancien <li> correspondant.
   */
  function reorder(list, ordered) {
    const itemSet = new Set(ordered);
    const children = Array.prototype.slice.call(list.children);
    const refs = [];

    children.forEach((child, index) => {
      if (!itemSet.has(child)) return;
      let ref = null;
      for (let i = index + 1; i < children.length; i += 1) {
        if (!itemSet.has(children[i])) {
          ref = children[i];
          break;
        }
      }
      refs.push(ref);
    });

    if (refs.length !== ordered.length) {
      ordered.forEach((el) => list.appendChild(el));
      return;
    }

    ordered.forEach((el) => el.remove());
    ordered.forEach((el, index) => list.insertBefore(el, refs[index] || null));
  }

  function annotate(entries) {
    entries.forEach((entry) => {
      if (entry.ts == null) return;
      const el = findDateEl(entry.el);
      if (!el) return;
      const date = new Date(entry.ts);
      const iso = date.toISOString();
      if (el.getAttribute('data-empl-date') === iso) return;
      el.setAttribute('data-empl-date', iso);
      if (entry.exact && dateFormatter) {
        el.setAttribute('title', 'Publiée le ' + dateFormatter.format(date));
      } else {
        el.setAttribute('title', 'Date de publication approximative');
      }
    });
  }

  function applyNow() {
    if (isGlobalMode(mode)) {
      ensureGlobalView();
      return;
    }
    if (applying) return;
    const list = listEl();
    if (!list) {
      setStatusText('');
      return;
    }

    ensureToolbar();
    const entries = buildEntries(list);
    if (!entries.length) {
      updateStatus(0, 0);
      return;
    }

    const ordered = sortEntries(entries);
    const orderedEls = ordered.map((entry) => entry.el);

    applying = true;
    try {
      if (!sameOrder(list, orderedEls)) reorder(list, orderedEls);
      annotate(entries);
      updateStatus(entries.filter((entry) => entry.ts != null).length, entries.length);
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    if (applyTimer) return;
    applyTimer = setTimeout(() => {
      applyTimer = 0;
      if (isGlobalMode(mode)) {
        ensureGlobalView();
        return;
      }
      applyNow();
    }, 120);
  }

  /* ------------------------------------------------------------------ */
  /* Vue globale : endpoints internes Emploitic, toutes les pages          */
  /* ------------------------------------------------------------------ */

  function isListingPage() {
    const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    if (path === '/offres-d-emploi') return true;
    if (/^\/offres-d-emploi\/q-[^/]+$/.test(path)) return true;
    if (/^\/offres-d-emploi\/(region|fonction|secteur)\/[^/]+$/.test(path)) return true;
    if (/^\/entreprises\/[^/]+\/offres-d-emploi$/.test(path)) return true;
    return !!document.querySelector('[data-testid="all-job-tab"]');
  }

  function recommendedTabSelected() {
    const tab = document.querySelector('[data-testid="recommended-jobs-tab"]');
    return !!(tab && tab.getAttribute('aria-selected') === 'true');
  }

  function paramValues(params, key) {
    const values = [];
    params.getAll(key).forEach((value) => {
      String(value).split(',').forEach((part) => values.push(part));
    });
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped + '\\[(\\d*)\\]$');
    params.forEach((value, name) => {
      if (name !== key && re.test(name)) values.push(value);
    });
    const cleaned = values.map((value) => String(value).trim()).filter(Boolean);
    return Array.from(new Set(cleaned));
  }

  function currentSearchValue() {
    const header = document.querySelector('[data-testid="jobs-search-header"]');
    const scope = header || document;
    const inputs = Array.prototype.slice.call(scope.querySelectorAll('input[type="text"]'));
    for (let i = 0; i < inputs.length; i += 1) {
      const placeholder = fold(inputs[i].getAttribute('placeholder') || '');
      if (placeholder.indexOf('commercial') >= 0 || placeholder.indexOf('developpeur') >= 0) {
        const value = inputs[i].value.trim();
        if (value) return value;
      }
    }
    return '';
  }

  function apiFilterParams() {
    const out = new URLSearchParams();
    const url = new URL(location.href);
    const mapping = {
      location: 'location.id',
      profession: 'profession.id',
      sector: 'company.sector.id',
      experienceLevel: 'experienceYears.id',
      postLevel: 'jobLevel.id',
      formationLevel: 'educationLevel.id'
    };

    Object.keys(mapping).forEach((key) => {
      paramValues(url.searchParams, key).forEach((value, index) => {
        out.append(mapping[key] + '[' + index + ']', value);
      });
    });

    paramValues(url.searchParams, 'workMode').forEach((value, index) => {
      out.append('workMode[' + index + ']', value);
    });

    const companyMatch = url.pathname.match(/^\/entreprises\/([^/]+)\/offres-d-emploi(?:\/|$)/);
    if (companyMatch) {
      try {
        out.set('company.alias', decodeURIComponent(companyMatch[1]));
      } catch (e) {
        out.set('company.alias', companyMatch[1]);
      }
    }

    let q = url.searchParams.get('q') || url.searchParams.get('search');
    if (!q) {
      const qMatch = url.pathname.match(/\/offres-d-emploi\/q-([^/]+)/);
      if (qMatch) {
        try {
          q = decodeURIComponent(qMatch[1]);
        } catch (e) {
          q = qMatch[1];
        }
        const typed = currentSearchValue();
        const normalized = (value) => fold(value).replace(/[\s-]+/g, '-');
        if (typed && normalized(typed) === normalized(q)) q = typed;
      }
    }
    if (q) out.set('q', q);

    return out;
  }

  function buildApiUrl() {
    const url = new URL(API_PATH, location.origin);
    url.searchParams.set('sortedBy', 'publishedAt');
    url.searchParams.set('sortOrder', mode === 'oldest-all' ? 'asc' : 'desc');
    url.searchParams.set('page', String(globalState.page));
    url.searchParams.set('limit', String(PAGE_SIZE));
    const filters = apiFilterParams();
    for (const pair of filters) {
      url.searchParams.append(pair[0], pair[1]);
    }
    return url;
  }

  function captureTemplates() {
    const list = listEl();
    if (!list) return;
    const item = list.querySelector(ITEM_SELECTOR);
    if (item) globalState.template = item.cloneNode(true);
    const hr = list.querySelector(':scope > hr');
    if (hr) globalState.hrTemplate = hr.cloneNode(false);
  }

  function setChipText(chip, text) {
    if (!chip) return;
    if (!text) {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = '';
    const svg = chip.querySelector(':scope > svg');
    Array.prototype.slice.call(chip.childNodes).forEach((node) => {
      if (node !== svg) chip.removeChild(node);
    });
    chip.appendChild(document.createTextNode(text));
  }

  function buildFallbackCard(offer) {
    const li = makeEl('li', 'empl-g-fallback');
    const link = document.createElement('a');
    link.className = 'empl-g-fallback-link';
    link.setAttribute('href', offerUrl(offer));

    const title = makeEl('h2', 'empl-g-fallback-title', offer && offer.title ? String(offer.title) : '');
    const company = makeEl('p', 'empl-g-fallback-company', companyName(offer));
    const meta = makeEl('p', 'empl-g-fallback-meta',
      [placeText(offer), relativeDate(offer && offer.publishedAt), levelText(offer)].filter(Boolean).join(' · '));
    const descText = stripHtml(offer && offer.description);
    const desc = makeEl('p', 'empl-g-fallback-desc', descText);

    link.appendChild(title);
    link.appendChild(company);
    link.appendChild(meta);
    if (descText) link.appendChild(desc);
    li.appendChild(link);
    return li;
  }

  function replaceLogoWithLetter(li, offer) {
    const logo = li.querySelector('[data-testid="jobs-item-logo"]');
    if (!logo) return;
    const wrap = logo.parentElement;
    const letter = makeEl('span', 'empl-g-logo-letter', logoLetter(offer));
    if (wrap) {
      logo.remove();
      wrap.appendChild(letter);
    } else {
      letter.style.width = '48px';
      letter.style.height = '48px';
      logo.replaceWith(letter);
    }
  }

  function applyLogo(li, offer) {
    const logo = li.querySelector('[data-testid="jobs-item-logo"]');
    if (!logo) return;
    if (logo.tagName !== 'IMG') {
      replaceLogoWithLetter(li, offer);
      return;
    }

    const paths = companyLogoPaths(offer).map(proxiedImage);
    let nextIndex = 0;

    logo.removeAttribute('srcset');
    logo.removeAttribute('sizes');
    logo.setAttribute('loading', 'lazy');
    logo.setAttribute('decoding', 'async');
    logo.setAttribute('alt', '');

    const loadNext = () => {
      if (nextIndex >= paths.length) {
        replaceLogoWithLetter(li, offer);
        return;
      }
      logo.setAttribute('src', paths[nextIndex]);
      nextIndex += 1;
    };

    logo.onerror = loadNext;
    loadNext();
  }

  function buildGlobalCard(offer) {
    if (!globalState.template) return buildFallbackCard(offer);
    const li = globalState.template.cloneNode(true);
    const link = li.querySelector('a');
    if (!link) return buildFallbackCard(offer);

    Array.prototype.slice.call(li.querySelectorAll('[data-empl-date]')).forEach((el) => {
      el.removeAttribute('data-empl-date');
    });
    Array.prototype.slice.call(li.querySelectorAll('[title]')).forEach((el) => {
      el.removeAttribute('title');
    });

    link.setAttribute('href', offerUrl(offer));
    link.removeAttribute('target');
    link.removeAttribute('rel');

    const logo = li.querySelector('[data-testid="jobs-item-logo"]');
    if (logo) applyLogo(li, offer);

    const title = li.querySelector('h2');
    if (title) title.textContent = offer && offer.title ? String(offer.title) : '';

    const company = li.querySelector('[data-testid="jobs-item-company"]');
    if (company) company.textContent = companyName(offer);

    const header = li.querySelector('[data-testid="jobs-item-header"]');
    const meta = header ? header.nextElementSibling : null;
    const chips = meta ? Array.prototype.slice.call(meta.children) : [];
    const chipByIcon = (icon) => chips.find((chip) => chip.querySelector('svg[data-testid="' + icon + '"]'));
    const locationChip = chipByIcon('RoomRoundedIcon') || chips[0];
    const dateChip = chipByIcon('TimelapseRoundedIcon') || chips[1];
    const levelChip = chipByIcon('BookmarkAddRoundedIcon') || chips[2];

    setChipText(locationChip, placeText(offer));
    setChipText(dateChip, relativeDate(offer && offer.publishedAt));
    setChipText(levelChip, levelText(offer));

    if (dateChip) {
      const date = new Date(offer && offer.publishedAt);
      if (!Number.isNaN(date.getTime()) && dateFormatter) {
        dateChip.setAttribute('title', 'Publiée le ' + dateFormatter.format(date));
      }
    }

    const desc = meta ? meta.nextElementSibling : null;
    if (desc) {
      const text = stripHtml(offer && offer.description);
      if (text) {
        desc.textContent = text;
        desc.style.display = '';
      } else {
        desc.textContent = '';
        desc.style.display = 'none';
      }
    }

    return li;
  }

  function createGlobalView() {
    const container = document.createElement('div');
    container.id = GLOBAL_ID;
    container.addEventListener('click', onGlobalClick);
    container.addEventListener('change', onGlobalChange);
    container.addEventListener('keydown', onGlobalKeydown);
    return container;
  }

  function positionGlobalView(container, list, paper) {
    const bar = document.getElementById(TOOLBAR_ID);
    if (bar && bar.parentElement === paper) {
      if (container.parentElement !== paper || container.previousElementSibling !== bar) {
        paper.insertBefore(container, bar.nextSibling);
      }
      return;
    }
    if (container.parentElement !== paper || container.nextElementSibling !== list) {
      paper.insertBefore(container, list);
    }
  }

  function removeGlobalUi() {
    if (document.body) document.body.classList.remove('empl-global-mode');
    const container = document.getElementById(GLOBAL_ID);
    if (container) container.remove();
  }

  function ensureGlobalView() {
    if (!isGlobalMode(mode)) return null;
    if (!isListingPage()) {
      removeGlobalUi();
      return null;
    }
    if (globalState.suspended || recommendedTabSelected()) {
      removeGlobalUi();
      return null;
    }
    const list = listEl();
    if (!list || !list.parentElement || !document.body) {
      removeGlobalUi();
      return null;
    }

    document.body.classList.add('empl-global-mode');
    ensureToolbar();
    if (!globalState.template) captureTemplates();

    const paper = list.parentElement;
    let container = document.getElementById(GLOBAL_ID);
    if (!container) container = createGlobalView();
    positionGlobalView(container, list, paper);

    if (!container.firstElementChild ||
        container.getAttribute('data-empl-version') !== String(globalState.version)) {
      renderGlobalView(container);
    }
    updateGlobalStatus();
    return container;
  }

  function renderGlobalView(container) {
    container.textContent = '';

    const top = makeEl('div', 'empl-g-top');
    const count = makeEl('span', 'empl-g-count');
    const pageInfo = makeEl('span', 'empl-g-pageinfo');

    if (globalState.loading) {
      count.textContent = globalState.total
        ? 'Chargement de la page ' + globalState.page + '…'
        : 'Chargement des offres…';
    } else if (globalState.error) {
      count.textContent = 'Erreur de chargement';
    } else if (!globalState.total) {
      count.textContent = 'Aucune offre';
    } else {
      const order = mode === 'oldest-all' ? 'plus anciennes d’abord' : 'plus récentes d’abord';
      count.textContent = 'Toutes les pages · ' + formatNumber(globalState.total) + ' offres · ' + order;
    }

    if (globalState.totalPages) {
      pageInfo.textContent = 'Page ' + globalState.page + ' / ' + globalState.totalPages;
      if (globalState.loading) pageInfo.textContent += ' · chargement…';
    } else if (globalState.loading) {
      pageInfo.textContent = '…';
    }

    top.appendChild(count);
    top.appendChild(pageInfo);
    container.appendChild(top);

    const content = makeEl('div', 'empl-g-body');
    if (globalState.error) {
      const note = makeEl('div', 'empl-g-note');
      note.appendChild(document.createTextNode('Impossible de charger les offres (' + globalState.error + '). '));
      const retry = makeEl('button', 'empl-g-retry', 'Réessayer');
      retry.type = 'button';
      retry.setAttribute('data-empl-retry', '1');
      note.appendChild(retry);
      content.appendChild(note);
    } else if (!globalState.offers.length) {
      content.appendChild(makeEl('div', 'empl-g-note',
        globalState.loading ? 'Chargement des offres…' : 'Aucune offre ne correspond à ces filtres.'));
    } else {
      const ul = document.createElement('ul');
      ul.className = 'empl-global-list';
      if (!globalState.hrTemplate) ul.className += ' empl-global-list--plain';
      const siteList = listEl();
      if (siteList && siteList.className) ul.className += ' ' + siteList.className;
      if (siteList && siteList.getAttribute('role')) ul.setAttribute('role', siteList.getAttribute('role'));

      globalState.offers.forEach((offer, index) => {
        let card = null;
        try {
          card = buildGlobalCard(offer);
        } catch (e) {
          card = buildFallbackCard(offer);
        }
        ul.appendChild(card);
        if (index < globalState.offers.length - 1 && globalState.hrTemplate) {
          ul.appendChild(globalState.hrTemplate.cloneNode(false));
        }
      });
      content.appendChild(ul);
    }
    container.appendChild(content);

    if (globalState.totalPages > 1) {
      const footer = makeEl('div', 'empl-g-footer');
      const disabled = globalState.loading;
      const prevDisabled = disabled || globalState.page <= 1;
      const nextDisabled = disabled || globalState.page >= globalState.totalPages;

      footer.appendChild(pageButton('«', 'first', 'Première page', prevDisabled));
      footer.appendChild(pageButton('‹ Précédente', 'prev', 'Page précédente', prevDisabled));

      const pageWrap = makeEl('span', 'empl-g-page');
      pageWrap.appendChild(document.createTextNode('Page '));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(globalState.totalPages);
      input.value = String(globalState.page);
      input.setAttribute('data-empl-gpage', '1');
      input.setAttribute('aria-label', 'Numéro de page');
      if (disabled) input.disabled = true;
      pageWrap.appendChild(input);
      pageWrap.appendChild(document.createTextNode(' sur ' + globalState.totalPages));
      footer.appendChild(pageWrap);

      footer.appendChild(pageButton('Suivante ›', 'next', 'Page suivante', nextDisabled));
      footer.appendChild(pageButton('»', 'last', 'Dernière page', nextDisabled));
      container.appendChild(footer);
    }
    container.setAttribute('data-empl-version', String(globalState.version));
  }

  function pageButton(label, action, title, disabled) {
    const button = makeEl('button', 'empl-g-pagebtn', label);
    button.type = 'button';
    button.setAttribute('data-empl-goto', action);
    button.setAttribute('title', title);
    if (disabled) button.disabled = true;
    return button;
  }

  function scrollToGlobalTop() {
    const container = document.getElementById(GLOBAL_ID);
    if (!container) return;
    const top = container.getBoundingClientRect().top + window.scrollY - 90;
    try {
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } catch (e) {
      window.scrollTo(0, Math.max(0, top));
    }
  }

  function goToGlobalPage(page) {
    if (globalState.loading) return;
    const max = globalState.totalPages || 1;
    const next = Math.min(max, Math.max(1, Math.round(Number(page) || 1)));
    if (next === globalState.page && globalState.offers.length && !globalState.error) return;
    loadGlobal(next);
    scrollToGlobalTop();
  }

  function onGlobalClick(event) {
    const target = event.target instanceof Element ? event.target : event.target && event.target.parentElement;
    if (!target) return;
    if (target.closest('[data-empl-retry]')) {
      if (!globalState.loading) loadGlobal(globalState.page || 1);
      return;
    }
    const button = target.closest('button[data-empl-goto]');
    if (!button || button.disabled) return;
    event.preventDefault();
    const action = button.getAttribute('data-empl-goto');
    let page = globalState.page;
    if (action === 'first') page = 1;
    else if (action === 'prev') page -= 1;
    else if (action === 'next') page += 1;
    else if (action === 'last') page = globalState.totalPages;
    goToGlobalPage(page);
  }

  function onGlobalChange(event) {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('[data-empl-gpage]')) return;
    goToGlobalPage(parseInt(target.value, 10));
  }

  function onGlobalKeydown(event) {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('[data-empl-gpage]')) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    goToGlobalPage(parseInt(target.value, 10));
  }

  async function loadGlobal(page) {
    const max = globalState.totalPages || Infinity;
    const target = Math.min(max, Math.max(1, Math.round(Number(page) || 1)));
    const seq = ++globalState.reqSeq;

    globalState.page = target;
    globalState.offers = [];
    globalState.loading = true;
    globalState.error = '';
    globalState.version++;
    ensureGlobalView();
    updateGlobalStatus();

    const apiUrl = buildApiUrl();
    try {
      const response = await fetch(apiUrl.toString(), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const json = await response.json();
      if (seq !== globalState.reqSeq) return;

      globalState.offers = Array.isArray(json.data) ? json.data : [];
      globalState.total = Number(json.total) || 0;
      globalState.totalPages = Number(json.totalPages) ||
        (globalState.offers.length ? 1 : 0);
      const current = Number(json.currentPage);
      if (current >= 1) globalState.page = current;
      globalState.loading = false;
      globalState.error = '';
      globalState.version++;
      ensureGlobalView();
      updateGlobalStatus();
    } catch (error) {
      if (seq !== globalState.reqSeq) return;
      globalState.loading = false;
      globalState.error = error && error.message ? error.message : 'Erreur inconnue';
      globalState.version++;
      ensureGlobalView();
      updateGlobalStatus();
    }
  }

  function enterGlobalMode() {
    if (!isGlobalMode(mode)) return;
    globalState.reqSeq += 1;
    globalState.suspended = false;
    globalState.page = 1;
    globalState.offers = [];
    globalState.total = 0;
    globalState.totalPages = 0;
    globalState.loading = false;
    globalState.error = '';
    globalState.version += 1;

    if (!isListingPage()) {
      removeGlobalUi();
      return;
    }

    captureTemplates();
    ensureGlobalView();
    updateGlobalStatus();
    loadGlobal(1);
  }

  function exitGlobalMode() {
    globalState.reqSeq += 1;
    globalState.suspended = false;
    globalState.loading = false;
    globalState.error = '';
    globalState.offers = [];
    globalState.total = 0;
    globalState.totalPages = 0;
    globalState.page = 1;
    removeGlobalUi();
  }

  function onGlobalUrlChange() {
    if (!isGlobalMode(mode)) return;
    globalState.reqSeq += 1;
    globalState.suspended = false;
    globalState.page = 1;
    globalState.offers = [];
    globalState.total = 0;
    globalState.totalPages = 0;
    globalState.loading = false;
    globalState.error = '';
    globalState.version += 1;

    if (!isListingPage()) {
      removeGlobalUi();
      return;
    }

    ensureGlobalView();
    updateGlobalStatus();
    loadGlobal(1);
  }

  function updateGlobalStatus() {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    if (globalState.suspended || recommendedTabSelected()) {
      setText(el, 'Vue « Pour toi »');
      const pausedTitle = 'Le tri global reprend quand vous revenez à « Toutes ».';
      if (el.title !== pausedTitle) el.title = pausedTitle;
      return;
    }
    if (globalState.loading) {
      setText(el, 'Chargement des offres…');
    } else if (globalState.error) {
      setText(el, 'Erreur de chargement');
    } else if (globalState.total) {
      setText(el, formatNumber(globalState.total) + ' offres · toutes les pages');
    } else {
      setText(el, 'Aucune offre');
    }
    const title = 'Tri appliqué à toutes les pages (endpoints internes Emploitic).';
    if (el.title !== title) el.title = title;
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('empl-sort-style')) return;
    const style = document.createElement('style');
    style.id = 'empl-sort-style';
    style.textContent = `
      #${TOOLBAR_ID}{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        padding:10px 16px;border-bottom:1px solid rgba(0,0,0,.08);background:#fff;
        font-family:inherit;font-size:13px;color:#33475b;box-sizing:border-box}
      #${TOOLBAR_ID} .empl-sort-label{font-weight:600;letter-spacing:.1px}
      #${TOOLBAR_ID} select{font:inherit;font-size:13px;color:#1f2d3d;background:#fff;
        border:1px solid #cfd8e3;border-radius:8px;padding:5px 28px 5px 10px;cursor:pointer;
        outline:none;appearance:auto}
      #${TOOLBAR_ID} select:focus{border-color:#1565c0;box-shadow:0 0 0 2px rgba(21,101,192,.15)}
      #${TOOLBAR_ID} .empl-sort-status{margin-left:auto;font-size:12px;color:#6b7c93}
      @media(max-width:520px){#${TOOLBAR_ID} .empl-sort-status{margin-left:0;width:100%}}

      body.empl-global-mode [data-testid="jobs-list"],
      body.empl-global-mode [data-testid="jobs-footer-section"]{display:none!important}

      #${GLOBAL_ID}{display:block;background:#fff;font-family:inherit}
      #${GLOBAL_ID} .empl-g-top{display:flex;align-items:center;justify-content:space-between;
        gap:12px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid rgba(0,0,0,.06);
        font-size:12px;color:#6b7c93}
      #${GLOBAL_ID} .empl-g-count{font-weight:600;color:#33475b}
      #${GLOBAL_ID} .empl-g-pageinfo{white-space:nowrap}
      #${GLOBAL_ID} .empl-global-list{list-style:none;margin:0;padding:0}
      #${GLOBAL_ID} .empl-global-list--plain > li{border-bottom:1px solid rgba(0,0,0,.06)}
      #${GLOBAL_ID} .empl-global-list--plain > li:last-child{border-bottom:0}
      #${GLOBAL_ID} .empl-g-logo-letter{display:flex;align-items:center;justify-content:center;
        width:100%;height:100%;min-width:44px;min-height:44px;border-radius:10px;
        background:#e8f0fe;color:#1565c0;font-weight:700;font-size:18px;line-height:1}
      #${GLOBAL_ID} .empl-g-note{padding:30px 16px;text-align:center;color:#6b7c93;font-size:14px}
      #${GLOBAL_ID} .empl-g-retry{font:inherit;font-size:13px;margin-left:6px;padding:4px 10px;
        border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#1f2d3d;cursor:pointer}
      #${GLOBAL_ID} .empl-g-retry:hover{background:#f3f7fb}
      #${GLOBAL_ID} .empl-g-footer{display:flex;align-items:center;justify-content:center;
        gap:8px;flex-wrap:wrap;padding:16px;border-top:1px solid rgba(0,0,0,.08)}
      #${GLOBAL_ID} .empl-g-pagebtn{font:inherit;font-size:13px;padding:6px 11px;
        border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#1f2d3d;cursor:pointer}
      #${GLOBAL_ID} .empl-g-pagebtn:hover:not(:disabled){background:#f3f7fb;border-color:#9fb3c8}
      #${GLOBAL_ID} .empl-g-pagebtn:disabled{opacity:.45;cursor:default}
      #${GLOBAL_ID} .empl-g-page{display:inline-flex;align-items:center;gap:5px;
        font-size:13px;color:#33475b}
      #${GLOBAL_ID} .empl-g-page input{width:64px;font:inherit;font-size:13px;text-align:center;
        border:1px solid #cfd8e3;border-radius:6px;padding:4px 2px;color:#1f2d3d;background:#fff}
      #${GLOBAL_ID} .empl-g-page input:focus{outline:none;border-color:#1565c0;
        box-shadow:0 0 0 2px rgba(21,101,192,.15)}
      @media(max-width:520px){#${GLOBAL_ID} .empl-g-pageinfo{display:none}}

      #${GLOBAL_ID} .empl-g-fallback{padding:16px;border-bottom:1px solid rgba(0,0,0,.06)}
      #${GLOBAL_ID} .empl-g-fallback-link{display:block;color:inherit;text-decoration:none}
      #${GLOBAL_ID} .empl-g-fallback-title{margin:0 0 4px;font-size:16px;line-height:1.35;color:#1f2d3d}
      #${GLOBAL_ID} .empl-g-fallback-company{margin:0 0 6px;font-size:13px;color:#6b7c93}
      #${GLOBAL_ID} .empl-g-fallback-meta{margin:0 0 8px;font-size:12px;color:#6b7c93}
      #${GLOBAL_ID} .empl-g-fallback-desc{margin:0;font-size:13px;line-height:1.5;color:#33475b;
        display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureToolbar() {
    const list = listEl();
    if (!list) return null;

    const existing = document.getElementById(TOOLBAR_ID);
    if (existing && existing.isConnected) return existing;

    injectStyles();

    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;

    const label = document.createElement('label');
    label.className = 'empl-sort-label';
    label.htmlFor = SELECT_ID;
    label.textContent = 'Trier par date';

    const select = document.createElement('select');
    select.id = SELECT_ID;

    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = "Ordre d'origine";
    select.appendChild(defaultOption);

    [
      ['Cette page', [
        ['newest', 'Plus récentes'],
        ['oldest', 'Plus anciennes']
      ]],
      ['Toutes les pages', [
        ['newest-all', 'Plus récentes'],
        ['oldest-all', 'Plus anciennes']
      ]]
    ].forEach((group) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group[0];
      group[1].forEach((option) => {
        const el = document.createElement('option');
        el.value = option[0];
        el.textContent = option[1];
        optgroup.appendChild(el);
      });
      select.appendChild(optgroup);
    });

    select.value = mode;
    select.addEventListener('change', () => setMode(select.value));

    const status = document.createElement('span');
    status.id = STATUS_ID;
    status.className = 'empl-sort-status';

    bar.appendChild(label);
    bar.appendChild(select);
    bar.appendChild(status);
    list.parentElement.insertBefore(bar, list);

    if (isGlobalMode(mode)) updateGlobalStatus();
    return bar;
  }

  function updateStatus(known, total) {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    if (mode === 'default' || !total) {
      setText(el, '');
      return;
    }
    setText(el, known === total ? 'Trié · ' + total + ' offres' : 'Trié · ' + known + '/' + total + ' dates');
    if (el.title !== 'Le tri s’applique aux offres affichées sur cette page.') {
      el.title = 'Le tri s’applique aux offres affichées sur cette page.';
    }
  }

  function setStatusText(text) {
    const el = document.getElementById(STATUS_ID);
    if (el) setText(el, text);
  }

  function setMode(next) {
    const nextMode = MODES.indexOf(next) >= 0 ? next : 'default';
    const wasGlobal = isGlobalMode(mode);
    mode = nextMode;
    saveMode(mode);

    const select = document.getElementById(SELECT_ID);
    if (select && select.value !== mode) select.value = mode;

    if (isGlobalMode(mode)) {
      enterGlobalMode();
      return;
    }

    if (wasGlobal) exitGlobalMode();
    applyNow();
    if (mode !== 'default') refreshDates();
  }

  function onDocumentClick(event) {
    if (!isGlobalMode(mode)) return;
    const target = event.target instanceof Element
      ? event.target
      : (event.target && event.target.parentElement);
    if (!target || !target.closest) return;

    if (target.closest('[data-testid="recommended-jobs-tab"]')) {
      globalState.suspended = true;
      removeGlobalUi();
      updateGlobalStatus();
      return;
    }

    if (target.closest('[data-testid="all-job-tab"]')) {
      globalState.suspended = false;
      updateGlobalStatus();
      scheduleApply();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Préférence                                                          */
  /* ------------------------------------------------------------------ */

  function validMode(value) {
    return MODES.indexOf(value) >= 0 ? value : 'default';
  }

  function loadMode(callback) {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      let next = value;
      if (next == null) {
        try {
          next = localStorage.getItem(MODE_KEY);
        } catch (e) {
          /* ignore */
        }
      }
      finished = true;
      callback(validMode(next));
    };

    let area = null;
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.sync) {
        area = browser.storage.sync;
      }
    } catch (e) {
      /* ignore */
    }
    if (!area) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          area = chrome.storage.sync;
        }
      } catch (e) {
        /* ignore */
      }
    }

    if (area && typeof area.get === 'function') {
      try {
        const maybe = area.get(MODE_KEY);
        if (maybe && typeof maybe.then === 'function') {
          maybe.then((result) => finish(result && result[MODE_KEY]))
            .catch(() => finish(undefined));
          setTimeout(() => finish(undefined), 1200);
          return;
        }
      } catch (e) {
        /* fall back to the callback API below */
      }
      try {
        area.get(MODE_KEY, (result) => finish(result && result[MODE_KEY]));
        setTimeout(() => finish(undefined), 1200);
        return;
      } catch (e) {
        /* fall back to localStorage */
      }
    }

    try {
      finish(localStorage.getItem(MODE_KEY));
    } catch (e) {
      finish(undefined);
    }
  }

  function saveMode(value) {
    let area = null;
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.sync) {
        area = browser.storage.sync;
      }
    } catch (e) {
      /* ignore */
    }
    if (!area) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          area = chrome.storage.sync;
        }
      } catch (e) {
        /* ignore */
      }
    }

    if (area && typeof area.set === 'function') {
      try {
        const maybe = area.set({ [MODE_KEY]: value });
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(MODE_KEY, value);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Surveillance de la page                                             */
  /* ------------------------------------------------------------------ */

  function insideManagedUi(node) {
    const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    return !!(el && el.closest && (el.closest('#' + TOOLBAR_ID) || el.closest('#' + GLOBAL_ID)));
  }

  function observe() {
    const observer = new MutationObserver((records) => {
      for (let i = 0; i < records.length; i += 1) {
        if (!insideManagedUi(records[i].target)) {
          scheduleApply();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      dataCache = { url: '', at: 0, map: new Map() };
      if (isGlobalMode(mode)) {
        onGlobalUrlChange();
      } else {
        scheduleApply();
        if (mode !== 'default') refreshDates();
      }
      return;
    }

    if (isGlobalMode(mode)) {
      ensureGlobalView();
      return;
    }
    if (mode !== 'default' && listEl()) scheduleApply();
  }

  function boot() {
    document.addEventListener('click', onDocumentClick, true);
    observe();

    loadMode((saved) => {
      mode = saved;
      const select = document.getElementById(SELECT_ID);
      if (select) select.value = mode;
      if (isGlobalMode(mode)) {
        enterGlobalMode();
      } else {
        applyNow();
        if (mode !== 'default') refreshDates();
      }
    });

    setTimeout(() => {
      if (isGlobalMode(mode)) ensureGlobalView();
      else applyNow();
    }, 300);
    setInterval(tick, 1500);
  }

  boot();
})();
