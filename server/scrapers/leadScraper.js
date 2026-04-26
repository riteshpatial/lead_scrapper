const puppeteer = require('puppeteer');
const cheerio   = require('cheerio');

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
const IGNORE_EMAIL_DOMAINS  = ['example.com','test.com','domain.com','yourdomain.com','sentry.io','wixpress.com','w3.org'];
const IGNORE_EMAIL_PREFIXES = ['noreply','no-reply','donotreply','mailer-daemon','postmaster','bounce'];
const IGNORE_EMAIL_EXT      = ['.png','.jpg','.jpeg','.gif','.svg','.css','.js','.webp','.ico'];

const SOCIAL_PATTERNS = [
  { key: 'facebook',  regex: /facebook\.com\/(?!sharer|share|login|dialog|photo|video|groups|hashtag|messages|watch|reel)([^/?#\s"']{2,})/i },
  { key: 'twitter',   regex: /(?:twitter|x)\.com\/(?!intent|share|home|search)([a-zA-Z0-9_]{1,50})/i },
  { key: 'linkedin',  regex: /linkedin\.com\/(company|in|school)\/([a-zA-Z0-9\-_.]{1,})/i },
  { key: 'instagram', regex: /instagram\.com\/(?!p\/|explore\/|accounts\/)([a-zA-Z0-9_.]{1,50})/i },
  { key: 'youtube',   regex: /youtube\.com\/(channel|user|c|@)\/([a-zA-Z0-9\-_]{1,})/i },
];

const ORG_TYPES = ['LocalBusiness','Organization','Corporation','Store','Restaurant','Hotel','MedicalBusiness','ProfessionalService'];

// ── Logging helper ────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] [scraper] ${msg}`);
}

// ── Address parser ────────────────────────────────────────────────────────────
function parseAddress(raw) {
  if (!raw) return { pinCode: '', city: '', locality: '' };
  const text = raw.replace(/\s+/g, ' ').trim();

  const pin6 = text.match(/\b(\d{6})\b/);
  const pin5 = !pin6 && text.match(/\b(\d{5})\b/);
  const pinCode = (pin6 || pin5 || [])[1] || '';

  let city = '', locality = '';
  const parts = text.replace(/[-–]/g, ',').split(',').map(p => p.trim()).filter(p => p.length > 1);

  if (pinCode) {
    const pinIdx = parts.findIndex(p => p.includes(pinCode));
    if (pinIdx > 0) {
      locality = parts[pinIdx - 1] || '';
      city     = parts[pinIdx - 2] || '';
    } else if (pinIdx === 0 && parts.length > 1) {
      city = parts[1] || '';
    }
    if (!city && pinIdx >= 0 && parts[pinIdx + 1]) city = parts[pinIdx + 1];
  } else if (parts.length >= 2) {
    locality = parts[parts.length - 1];
    city     = parts[parts.length - 2] || '';
  }

  if (/^\d+$/.test(city))     city     = '';
  if (/^\d+$/.test(locality)) locality = '';

  return { pinCode, city: city.slice(0, 60), locality: locality.slice(0, 80) };
}

// ── Normalise a raw listing into a flat lead object ───────────────────────────
function normaliseLead(item, defaults = {}) {
  const { pinCode, city, locality } = parseAddress(item.address || '');
  return {
    state:       item.state       || defaults.state || '',
    dealerName:  item.dealerName  || item.companyName || defaults.dealerName || '',
    companyName: item.companyName || '',
    city:        item.city        || city        || '',
    locality:    item.locality    || locality    || '',
    pinCode:     item.pinCode     || pinCode     || '',
    address:     item.address     || '',
    phone:       (item.phones || [])[0] || '',
    phones:      item.phones  || [],
    email:       (item.emails || [])[0] || '',
    emails:      item.emails  || [],
    rating:      item.rating  ?? null,
    status:      item.status  || '',
    services:    item.services || [],
    website:     item.website  || '',
    sourceUrl:   defaults.sourceUrl || '',
    scrapedAt:   new Date().toISOString(),
  };
}

class LeadScraper {
  constructor() { this.browser = null; }

  async init() {
    log('Launching browser...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-accelerated-2d-canvas','--no-first-run','--disable-gpu'],
    });
    log('Browser ready.');
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; log('Browser closed.'); }
  }

  async openPage() {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', r => (['image','font','media'].includes(r.resourceType()) ? r.abort() : r.continue()));
    return page;
  }

  // ── Scroll the full page to trigger lazy-loading ───────────────────────────
  async scrollPage(page) {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let scrolled = 0;
        const step = 400, max = Math.min(document.body.scrollHeight, 15000);
        const t = setInterval(() => {
          window.scrollBy(0, step); scrolled += step;
          if (scrolled >= max) { clearInterval(t); window.scrollTo(0, 0); resolve(); }
        }, 120);
      });
    });
    await new Promise(r => setTimeout(r, 800));
  }

  async navigateAndWait(page, url) {
    log(`  → navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await this.scrollPage(page);
  }

  // ── Repeatedly click LOAD MORE until it disappears ─────────────────────────
  async clickLoadMore(page, onProgress) {
    let clicks = 0;
    while (clicks < 15) {
      const btnText = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button,a,[role="button"]')]
          .find(el => el.offsetParent !== null &&
            /load\s*more|show\s*more|view\s*more/i.test((el.textContent || '').trim()));
        if (!btn) return null;
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        return (btn.textContent || '').trim().slice(0, 40);
      });
      if (!btnText) break;
      clicks++;
      const msg = `  → clicked "${btnText}" (${clicks})`;
      log(msg);
      onProgress?.(msg);
      await new Promise(r => setTimeout(r, 2200));
    }
    if (clicks) log(`  → LOAD MORE done after ${clicks} click(s)`);
  }

  // ── CORE: 3-strategy listing detection ─────────────────────────────────────
  async detectListings(page, stateName = '') {
    const count = await page.evaluate(() => document.querySelectorAll('*').length);
    log(`  → detectListings (DOM nodes: ${count}, state: "${stateName}")`);

    const results = await page.evaluate((state) => {
      const EMAIL_RX   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i;
      const EMAIL_RX_G = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
      const PURE_PHONE = /^[\+\d\s\-\(\)\.]{7,25}$/;
      const SKIP_LINE  = /^(direction|directions|call now|website|read reviews?|book|get directions?|find dealer|view more|sales|service|spares|more info|locate|map|open|close|show more|load more|contact|know more|enquir|inquir|connect|expert)/i;

      function getEmails(el) {
        const fromLinks = [...el.querySelectorAll('a[href^="mailto:"]')]
          .map(a => a.href.replace('mailto:','').split('?')[0].toLowerCase().trim())
          .filter(e => e.includes('@') && e.includes('.'));
        const fromText = ((el.innerText || '').match(EMAIL_RX_G) || []).map(e => e.toLowerCase());
        return [...new Set([...fromLinks, ...fromText])].filter(e => e.includes('@') && !e.includes(' '));
      }

      function getPhones(el) {
        const fromLinks = [...el.querySelectorAll('a[href^="tel:"]')]
          .map(a => {
            const txt = (a.innerText || a.textContent || '').replace(/\s+/g,' ').trim();
            const href = a.href.replace('tel:','').trim();
            return (txt && /\d{5,}/.test(txt)) ? txt : href;
          })
          .filter(p => p && p.replace(/\D/g,'').length >= 7);
        const lines = (el.innerText || '').split('\n').map(l => l.trim());
        const fromText = lines.filter(l => {
          if (!l || l.length < 6 || l.length > 25) return false;
          const d = l.replace(/\D/g,'');
          return d.length >= 7 && d.length <= 15 && PURE_PHONE.test(l);
        });
        return [...new Set([...fromLinks, ...fromText])].filter(p => p.replace(/\D/g,'').length >= 7);
      }

      function buildCard(card, emails, phones) {
        const heads   = [...card.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const dealerName = heads.map(h => h.textContent.trim()).find(t => t.length > 0) || '';
        const companyEl  = [...card.querySelectorAll('strong,b')]
          .find(el => { const t = el.textContent.trim(); return t && t !== dealerName && t.length > 2 && t.length < 200; });
        const companyName = companyEl?.textContent.trim() || '';

        // Line-based address extraction: strip dealer/company names, emails, phones, buttons
        const emailSet    = new Set(emails.map(e => e.toLowerCase()));
        const phoneDigits = new Set(phones.map(p => p.replace(/\D/g,'')));
        const lines = (card.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
        const addrLines = lines.filter(l => {
          if (!l || l.length < 3 || l.length > 200) return false;
          if (l === dealerName || l === companyName) return false;
          if (emailSet.has(l.toLowerCase()) || EMAIL_RX.test(l)) return false;
          const d = l.replace(/\D/g,'');
          if (d.length >= 7 && (phoneDigits.has(d) || (PURE_PHONE.test(l) && d.length >= 7))) return false;
          if (SKIP_LINE.test(l.trim()) && l.length < 50) return false;
          return true;
        });
        const address = addrLines.join(', ');

        // Rating
        let rating = null;
        const rEl = card.querySelector('[class*="rating"],[class*="star"],[data-rating]');
        if (rEl) {
          const rv = rEl.getAttribute('data-rating') || (rEl.textContent.match(/[\d.]+/) || [])[0];
          if (rv) rating = parseFloat(rv);
        }
        if (!rating) { const m = (card.innerText||'').match(/(\d+\.?\d*)\s*\/\s*5/); if (m) rating = parseFloat(m[1]); }

        // Status
        const clo = (card.innerText || '').toLowerCase();
        let status = '';
        if (/open\s*now/.test(clo))  status = 'Open Now';
        else if (/\bclosed\b/.test(clo)) status = 'Closed';

        // Website (prefer WEBSITE button, then external link)
        const aLinks = [...card.querySelectorAll('a[href^="http"],a[href^="//"]')];
        const websiteBtn  = aLinks.find(a => /^website$|visit website/i.test((a.textContent||'').trim()));
        const externalLnk = aLinks.find(a => {
          const h = a.href.toLowerCase();
          return !['google','facebook','twitter','instagram','youtube','linkedin','maps','goo.gl',window.location.hostname].some(d => h.includes(d));
        });
        const website = websiteBtn?.href || externalLnk?.href || '';

        // Services
        const services = [...new Set(
          [...card.querySelectorAll('button,[class*="service"],[class*="tag"],[class*="badge"],[class*="label"],[class*="pill"]')]
            .map(el => el.textContent.trim())
            .filter(t => t.length >= 2 && t.length <= 40 && !/^(read|get|view|book|call|find|visit|show|click|more|open|close|map|dir|review|connect|website|load|direction|know|enquir|inquir)/i.test(t))
        )].slice(0, 8);

        return { dealerName, companyName, emails, phones, address, rating, status, services, website };
      }

      // ── Strategy 1: mailto / tel links ──────────────────────────────────────
      function s1() {
        function upToCard(el) {
          let node = el.parentElement;
          for (let d = 0; d < 15 && node && node !== document.body; d++) {
            if (node.querySelector('h1,h2,h3,h4,h5,h6')) {
              const r = node.getBoundingClientRect();
              if (r.height >= 60 && r.width >= 120) return node;
            }
            node = node.parentElement;
          }
          return null;
        }
        const contactEls = [...document.querySelectorAll('a[href^="mailto:"],a[href^="tel:"]')];
        if (contactEls.length < 2) return null;
        const seen = new WeakSet(), results = [];
        for (const el of contactEls) {
          const card = upToCard(el);
          if (!card || seen.has(card)) continue;
          seen.add(card);
          const emails = getEmails(card), phones = getPhones(card);
          const data = buildCard(card, emails, phones);
          if (data.dealerName || emails.length || phones.length) results.push({ ...data, state });
        }
        return results.length >= 2 ? results : null;
      }

      // ── Strategy 2: plain-text email node → walk up to heading ancestor ─────
      function s2() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new WeakSet(), results = [];
        let n;
        while ((n = walker.nextNode())) {
          if (!EMAIL_RX.test(n.textContent)) continue;
          let node = n.parentElement, card = null;
          for (let d = 0; d < 15 && node && node !== document.body; d++) {
            if (node.querySelector('h1,h2,h3,h4,h5,h6')) {
              const r = node.getBoundingClientRect();
              if (r.height >= 60 && r.width >= 120) { card = node; break; }
            }
            node = node.parentElement;
          }
          if (!card || seen.has(card)) continue;
          seen.add(card);
          const emails = getEmails(card), phones = getPhones(card);
          const data = buildCard(card, emails, phones);
          if (data.dealerName || emails.length || phones.length) results.push({ ...data, state });
        }
        return results.length >= 2 ? results : null;
      }

      // ── Strategy 3: repeated CSS class with heading + email ─────────────────
      function s3() {
        const classMap = {};
        for (const el of document.querySelectorAll('div,li,article,section')) {
          const cls = (typeof el.className === 'string' ? el.className : '').trim();
          if (!cls) continue;
          const txt = el.innerText || '';
          if (txt.length < 20 || txt.length > 8000) continue;
          if (!el.querySelector('h1,h2,h3,h4,h5,h6')) continue;
          if (!EMAIL_RX.test(txt)) continue;
          if (!classMap[cls]) classMap[cls] = [];
          classMap[cls].push(el);
        }
        const candidates = Object.entries(classMap)
          .filter(([, els]) => els.length >= 2)
          .sort(([, a], [, b]) => b.length !== a.length
            ? b.length - a.length
            : (a.reduce((s,e)=>s+(e.innerText||'').length,0)/a.length) - (b.reduce((s,e)=>s+(e.innerText||'').length,0)/b.length));

        for (const [cls, els] of candidates) {
          const seen = new WeakSet(), results = [];
          for (const card of els) {
            if (seen.has(card)) continue;
            seen.add(card);
            const emails = getEmails(card), phones = getPhones(card);
            const data = buildCard(card, emails, phones);
            if (data.dealerName) results.push({ ...data, state });
          }
          if (results.length >= 2) return results;
        }
        return null;
      }

      return s1() || s2() || s3();
    }, stateName);

    if (results) {
      log(`  → detectListings: ${results.length} cards found`);
    } else {
      log(`  → detectListings: no multi-card listings detected`);
    }
    return results;
  }

  // ── Detect state/city filters on the page ─────────────────────────────────
  async detectFilters(page) {
    log('  → detectFilters...');
    const filters = await page.evaluate(() => {
      const f = {};

      // Dropdown-based
      for (const sel of document.querySelectorAll('select')) {
        const labelEl = sel.id ? document.querySelector(`label[for="${sel.id}"]`) : null;
        const hint = (
          labelEl?.textContent ||
          sel.previousElementSibling?.textContent ||
          sel.getAttribute('aria-label') ||
          sel.getAttribute('placeholder') ||
          sel.getAttribute('name') ||
          sel.getAttribute('id') || ''
        ).toLowerCase().trim();

        const skipVals = new Set(['','--','select state','all states','choose state','any state','select','all','choose','any','0','-1']);
        const opts = [...sel.options]
          .map(o => ({ value: o.value, label: o.text.trim() }))
          .filter(o => o.value && !skipVals.has(o.label.toLowerCase()) && !skipVals.has(o.value));

        if (opts.length >= 2 && /state|province|region/.test(hint)) {
          f.type = 'dropdown';
          f.stateOptions = opts;
          f.stateSelector = sel.name || sel.id || '';
          f.stateSelectorCSS = sel.name ? `select[name="${sel.name}"]` : sel.id ? `select#${sel.id}` : 'select';
          break;
        }
      }

      if (f.type === 'dropdown') {
        const btn = [...document.querySelectorAll('button,input[type="submit"],input[type="button"]')]
          .find(el => /search|find|go|submit|dealer/i.test((el.textContent || el.value || '').trim()));
        if (btn) {
          f.searchSelector = btn.id
            ? `#${btn.id}`
            : btn.name ? `[name="${btn.name}"]`
            : btn.className ? `.${btn.className.trim().split(/\s+/)[0]}`
            : 'button[type="submit"]';
        }
      }

      // Link-based fallback
      if (!f.type) {
        const navLinks = [...document.querySelectorAll(
          '[class*="state"] a,[class*="region"] a,[id*="state"] a,[id*="region"] a,[class*="location-nav"] a,[class*="city-list"] a,nav a'
        )]
          .map(a => ({ label: (a.textContent||'').trim(), href: a.href }))
          .filter(l => l.label && l.href && l.label.length < 60 && l.href.startsWith('http') && !l.href.includes('#'));
        if (navLinks.length >= 5) { f.type = 'links'; f.stateLinks = navLinks; }
      }

      return f.type ? f : null;
    });

    if (filters) log(`  → detectFilters: type="${filters.type}", options=${filters.stateOptions?.length || filters.stateLinks?.length || 0}`);
    else          log(`  → detectFilters: none found`);
    return filters;
  }

  // ── Scrape via dropdown: select state → SEARCH → extract ──────────────────
  async scrapeStateWithDropdown(url, stateOption, cssSelector, searchSelector, onProgress) {
    const label = stateOption.label;
    log(`[${label}] scrapeStateWithDropdown start`);
    onProgress?.(`Navigating to site...`);

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, url);

      // Select state value and fire events
      log(`[${label}] Selecting state dropdown (value="${stateOption.value}", css="${cssSelector}")`);
      onProgress?.(`Selecting state: ${label}`);
      const selected = await page.evaluate((css, val) => {
        const el = document.querySelector(css);
        if (!el) return false;
        el.value = val;
        ['input','change'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
        return true;
      }, cssSelector, stateOption.value);
      log(`[${label}] State select result: ${selected}`);

      // Wait for any cascading dropdowns to update
      await new Promise(r => setTimeout(r, 1500));

      // Click SEARCH — wait for navigation (form submit) OR settle (AJAX)
      log(`[${label}] Clicking SEARCH button (selector="${searchSelector}")`);
      onProgress?.(`Clicking SEARCH, waiting for results...`);
      const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
      const clicked = await page.evaluate((searchSel) => {
        let btn = searchSel ? document.querySelector(searchSel) : null;
        if (!btn) {
          btn = [...document.querySelectorAll('button,input[type="submit"],input[type="button"]')]
            .find(el => /search|find|go|submit|dealer/i.test((el.textContent || el.value || '').trim()));
        }
        if (!btn) return 'NOT_FOUND';
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return btn.textContent?.trim() || btn.value || 'clicked';
      }, searchSelector || '');
      log(`[${label}] SEARCH button: ${clicked}`);
      await navPromise;
      log(`[${label}] Navigation/settle after SEARCH done`);

      // Extra wait + scroll for AJAX content
      await new Promise(r => setTimeout(r, 2500));
      onProgress?.(`Loading results...`);
      await this.scrollPage(page);

      // Click LOAD MORE until done
      onProgress?.(`Checking for LOAD MORE...`);
      await this.clickLoadMore(page, onProgress);

      // Extract listings
      onProgress?.(`Extracting dealer cards...`);
      const rawListings = await this.detectListings(page, label);
      await page.close();

      if (!rawListings || !rawListings.length) {
        log(`[${label}] No listings found`);
        onProgress?.(`No listings found for ${label}`);
        return [];
      }

      log(`[${label}] Extracted ${rawListings.length} dealers`);
      onProgress?.(`Extracted ${rawListings.length} dealers`);
      return rawListings.map(item => normaliseLead(item, { state: label, sourceUrl: url }));
    } catch (err) {
      log(`[${label}] ERROR: ${err.message}`);
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Scrape one state page (link-based navigation) ─────────────────────────
  async scrapeStatePage(stateLink, onProgress) {
    const label = stateLink.label;
    log(`[${label}] scrapeStatePage: ${stateLink.href}`);
    onProgress?.(`Navigating to ${stateLink.href}`);

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, stateLink.href);
      onProgress?.(`Clicking LOAD MORE if present...`);
      await this.clickLoadMore(page, onProgress);
      onProgress?.(`Extracting dealer cards...`);
      const rawListings = await this.detectListings(page, label);
      await page.close();

      if (!rawListings || !rawListings.length) {
        log(`[${label}] No listings found`);
        return [];
      }
      log(`[${label}] Extracted ${rawListings.length} dealers`);
      return rawListings.map(item => normaliseLead(item, { state: label, sourceUrl: stateLink.href }));
    } catch (err) {
      log(`[${label}] ERROR: ${err.message}`);
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Scrape a single arbitrary URL ─────────────────────────────────────────
  // Returns { leads, filters } so the route can forward filter info to the client.
  async scrapeUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    log(`scrapeUrl: ${url}`);

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, url);
      await this.clickLoadMore(page);

      const rawListings = await this.detectListings(page);
      if (rawListings && rawListings.length >= 2) {
        log(`scrapeUrl: listing page — ${rawListings.length} cards`);
        await page.close();
        const leads = rawListings.map(item => ({
          ...normaliseLead(item, { sourceUrl: url }),
          isListingItem: true,
        }));
        return { leads, filters: null };
      }

      // No listings — check for filter/search forms before falling back
      log('scrapeUrl: no listings, checking for filter forms...');
      const filters = await this.detectFilters(page);
      if (filters) {
        log(`scrapeUrl: filter page detected (type=${filters.type}) — returning empty leads`);
        await page.close();
        return { leads: [], filters };
      }

      // ── Single business fallback ─────────────────────────────────────────
      log('scrapeUrl: single business fallback');
      const html = await page.content();
      const text = await page.evaluate(() => {
        document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
        return document.body?.innerText || '';
      });
      await page.close();

      const $ = cheerio.load(html);
      const meta       = this.extractMeta($);
      const structured = this.extractStructuredData($);
      let emails = this.extractEmails(html, text);
      let phones = this.extractPhonesFromText(text);
      const social = this.extractSocialMedia($);
      if (structured.telephone) phones = [...new Set([structured.telephone, ...phones])];
      if (structured.email)     emails = [...new Set([structured.email, ...emails])];

      const subLinks = this.findSubPageLinks($, url);
      let pagesScraped = 1;
      for (const subUrl of subLinks) {
        try {
          const sp = await this.openPage();
          try {
            await this.navigateAndWait(sp, subUrl);
            const sh = await sp.content();
            const st = await sp.evaluate(() => { document.querySelectorAll('script,style,noscript').forEach(e=>e.remove()); return document.body?.innerText||''; });
            await sp.close();
            const $s = cheerio.load(sh);
            emails = [...new Set([...emails, ...this.extractEmails(sh, st)])];
            phones = [...new Set([...phones, ...this.extractPhonesFromText(st)])];
            const ss = this.extractSocialMedia($s);
            Object.keys(ss).forEach(k => { if (!social[k]) social[k] = ss[k]; });
            const sd = this.extractStructuredData($s);
            if (!structured.address && sd.address)       structured.address      = sd.address;
            if (!structured.businessName && sd.businessName) structured.businessName = sd.businessName;
            pagesScraped++;
          } catch(e) { await sp.close().catch(()=>{}); }
        } catch(_) {}
      }

      const { pinCode, city, locality } = parseAddress(structured.address || '');
      const businessName = structured.businessName || meta.siteName
        || (meta.title ? meta.title.split(/[|\-–]/)[0].trim() : '')
        || new URL(url).hostname.replace('www.','');

      log(`scrapeUrl: single biz "${businessName}", ${emails.length} emails, ${phones.length} phones`);
      return {
        leads: [{
          state: structured.state || '',
          dealerName: businessName,
          companyName: '',
          city: structured.city || city || '',
          locality,
          pinCode: structured.postalCode || pinCode || '',
          address: structured.address || '',
          phone: phones[0] || '',
          phones: phones.slice(0, 8),
          email: emails[0] || '',
          emails: emails.slice(0, 10),
          rating: null,
          status: '',
          services: [],
          website: url,
          socialMedia: social,
          description: structured.description || meta.description || '',
          openingHours: structured.openingHours || '',
          sourceUrl: url,
          isListingItem: false,
          pagesScraped,
          scrapedAt: new Date().toISOString(),
        }],
        filters: null,
      };
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Quick analysis: detect filters without full scrape ────────────────────
  async analyzeUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    log(`analyzeUrl: ${url}`);
    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, url);
      const filters = await this.detectFilters(page);
      await page.close();
      return { url, filters };
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  extractEmails(html, text) {
    const raw = (html + ' ' + text).match(EMAIL_REGEX) || [];
    return [...new Set(raw.map(e => e.toLowerCase().trim()).filter(e => {
      const [pfx, dom] = e.split('@');
      if (!dom) return false;
      if (IGNORE_EMAIL_EXT.some(x => e.endsWith(x)))       return false;
      if (IGNORE_EMAIL_DOMAINS.some(d => dom.includes(d))) return false;
      if (IGNORE_EMAIL_PREFIXES.some(p => pfx.startsWith(p))) return false;
      return true;
    }))];
  }

  extractPhonesFromText(text) {
    const PHONE_RE = /(?:\+?(?:\d{1,3})[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
    const raw = text.match(PHONE_RE) || [];
    return [...new Set(raw.map(p => p.trim()).filter(p => {
      const d = p.replace(/\D/g,''); return d.length >= 10 && d.length <= 15;
    }))].slice(0, 8);
  }

  extractSocialMedia($) {
    const social = {};
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      for (const { key, regex } of SOCIAL_PATTERNS)
        if (!social[key] && regex.test(href)) social[key] = href.startsWith('http') ? href : 'https://'+href.replace(/^\/\//,'');
    });
    return social;
  }

  extractStructuredData($) {
    const r = {};
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const items = [].concat(JSON.parse($(el).html()));
        for (const item of items) {
          const t = String(item['@type'] || '');
          if (ORG_TYPES.includes(t) || t.includes('Business')) {
            if (item.name)         r.businessName  = r.businessName  || item.name;
            if (item.description)  r.description   = r.description   || item.description;
            if (item.telephone)    r.telephone     = r.telephone     || item.telephone;
            if (item.email)        r.email         = r.email         || item.email;
            if (item.openingHours) r.openingHours  = Array.isArray(item.openingHours) ? item.openingHours.join(', ') : item.openingHours;
            if (item.address) {
              const a = item.address;
              r.address    = r.address    || (typeof a === 'string' ? a : [a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode,a.addressCountry].filter(Boolean).join(', '));
              r.city       = r.city       || a.addressLocality  || '';
              r.state      = r.state      || a.addressRegion    || '';
              r.country    = r.country    || a.addressCountry   || '';
              r.postalCode = r.postalCode || a.postalCode       || '';
            }
          }
        }
      } catch (_) {}
    });
    return r;
  }

  extractMeta($) {
    return {
      title:       $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
      siteName:    $('meta[property="og:site_name"]').attr('content') || '',
    };
  }

  findSubPageLinks($, baseUrl) {
    const origin = new URL(baseUrl).origin;
    const kw = ['contact','about','team','reach','connect','location','support'];
    const links = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (kw.some(k => ($(el).text() + href).toLowerCase().includes(k))) {
        try {
          const full = new URL(href, baseUrl).href;
          if (full.startsWith(origin) && full !== baseUrl && !full.includes('#')) links.add(full);
        } catch (_) {}
      }
    });
    return [...links].slice(0, 3);
  }
}

module.exports = LeadScraper;
