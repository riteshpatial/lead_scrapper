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
    if (pinIdx > 0)                    { locality = parts[pinIdx - 1] || ''; city = parts[pinIdx - 2] || ''; }
    else if (pinIdx === 0 && parts[1]) { city = parts[1]; }
    if (!city && pinIdx >= 0 && parts[pinIdx + 1]) city = parts[pinIdx + 1];
  } else if (parts.length >= 2) {
    locality = parts[parts.length - 1];
    city     = parts[parts.length - 2] || '';
  }
  if (/^\d+$/.test(city))     city     = '';
  if (/^\d+$/.test(locality)) locality = '';
  return { pinCode, city: city.slice(0, 60), locality: locality.slice(0, 80) };
}

function normaliseLead(item, defaults = {}) {
  const { pinCode, city, locality } = parseAddress(item.address || '');
  return {
    state:       item.state       || defaults.state     || '',
    dealerName:  item.dealerName  || item.companyName   || defaults.dealerName || '',
    companyName: item.companyName || '',
    city:        item.city        || city               || '',
    locality:    item.locality    || locality           || '',
    pinCode:     item.pinCode     || pinCode            || '',
    address:     item.address     || '',
    phone:       (item.phones || [])[0] || '',
    phones:      item.phones      || [],
    email:       (item.emails || [])[0] || '',
    emails:      item.emails      || [],
    rating:      item.rating      ?? null,
    status:      item.status      || '',
    services:    item.services    || [],
    website:     item.website     || '',
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

  async scrollPage(page) {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let scrolled = 0;
        const step = 400, max = Math.min(document.body.scrollHeight, 20000);
        const t = setInterval(() => {
          window.scrollBy(0, step); scrolled += step;
          if (scrolled >= max) { clearInterval(t); window.scrollTo(0, 0); resolve(); }
        }, 100);
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

  // ── Dump page structure for debugging (only called when detection fails) ────
  async dumpPageInfo(page) {
    const info = await page.evaluate(() => {
      const EMAIL_RX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i;
      const PHONE_D  = /\d{8,}/;
      const top = [];
      for (const el of document.querySelectorAll('div,li,article,section')) {
        const txt = (el.innerText || '').trim();
        if (txt.length < 20 || txt.length > 5000) continue;
        if (!EMAIL_RX.test(txt) && !PHONE_D.test(txt)) continue;
        const cls = el.className || '';
        top.push({ tag: el.tagName, cls: cls.slice(0, 60), lines: txt.split('\n').filter(l => l.trim()).length, len: txt.length });
        if (top.length >= 30) break;
      }
      return top;
    });
    log('  → PAGE ELEMENTS WITH CONTACT INFO:');
    info.forEach(e => log(`     <${e.tag} class="${e.cls}"> — ${e.lines} lines, ${e.len} chars`));
  }

  // ── Click LOAD MORE until gone ─────────────────────────────────────────────
  async clickLoadMore(page, onProgress) {
    let clicks = 0;
    while (clicks < 20) {
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
      log(msg); onProgress?.(msg);
      await new Promise(r => setTimeout(r, 2200));
    }
    if (clicks) log(`  → LOAD MORE done: ${clicks} click(s)`);
  }

  // ── Wait until >= 2 contact-bearing elements appear ───────────────────────
  async waitForCards(page, timeoutMs = 10000) {
    log('  → waiting for dealer cards to appear...');
    try {
      await page.waitForFunction(() => {
        const EMAIL_RX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i;
        const PHONE_D  = /\d{8,}/;
        let n = 0;
        for (const el of document.querySelectorAll('div,li,article')) {
          const txt = el.innerText || '';
          if (txt.length < 20 || txt.length > 5000) continue;
          if (EMAIL_RX.test(txt) || PHONE_D.test(txt)) { n++; if (n >= 2) return true; }
        }
        return false;
      }, { timeout: timeoutMs });
      log('  → cards detected in DOM');
    } catch (_) {
      log('  → waitForCards timed out — proceeding anyway');
    }
  }

  // ── CORE: 4-strategy listing detection ─────────────────────────────────────
  async detectListings(page, stateName = '') {
    log(`  → detectListings (state="${stateName}")`);

    const results = await page.evaluate((state) => {
      const EMAIL_RX   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i;
      const EMAIL_RX_G = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
      const PURE_PHONE = /^[\+\d\s\-\(\)\.]{7,25}$/;
      const PHONE_LINE = /^\+?[\d\s\-\(\)\.]{7,}$/;
      const SKIP_LINE  = /^(direction|directions|call\s*now|website|read reviews?|book|get direction|find dealer|view more|load more|show more|contact|know more|enquir|inquir|connect|expert|map|locate|open|close)/i;
      const BTN_ONLY   = /^(sales|service|spares|parts|accessories)$/i;

      // ── extract emails from element ─────────────────────────────────────────
      function getEmails(el) {
        const fromLinks = [...el.querySelectorAll('a[href^="mailto:"]')]
          .map(a => a.href.replace('mailto:','').split('?')[0].toLowerCase().trim())
          .filter(e => e.includes('@') && e.includes('.'));
        const fromText = ((el.innerText || '').match(EMAIL_RX_G) || []).map(e => e.toLowerCase());
        return [...new Set([...fromLinks, ...fromText])].filter(e => e.includes('@') && !e.includes(' '));
      }

      // ── extract phones from element ─────────────────────────────────────────
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

      // ── extract all data from a card element ────────────────────────────────
      function buildCard(card, emails, phones) {
        // ── Dealer name: 1) heading tag  2) name-class  3) first valid line ──
        const heads = [...card.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        let dealerName = heads.map(h => h.textContent.trim()).find(t => t.length > 0) || '';

        if (!dealerName) {
          const nameEl = card.querySelector(
            '[class*="dealer-name"],[class*="dealername"],[class*="shop-name"],[class*="firm-name"],' +
            '[class*="name"],[class*="title"],[class*="heading"],[class*="firm"],[class*="brand"]'
          );
          if (nameEl) dealerName = nameEl.textContent.trim().split('\n')[0].trim().slice(0, 120);
        }

        if (!dealerName) {
          const emailSet    = new Set(emails.map(e => e.toLowerCase()));
          const phoneDigits = new Set(phones.map(p => p.replace(/\D/g,'')));
          const lines       = (card.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
          dealerName = lines.find(l => {
            if (!l || l.length < 2 || l.length > 120) return false;
            if (emailSet.has(l.toLowerCase()) || EMAIL_RX.test(l)) return false;
            const d = l.replace(/\D/g,'');
            if (d.length >= 7 && (phoneDigits.has(d) || PURE_PHONE.test(l))) return false;
            if (SKIP_LINE.test(l.trim()) && l.length < 50) return false;
            if (BTN_ONLY.test(l.trim())) return false;
            // Skip all-uppercase short strings (SALES, SERVICE, etc.)
            if (l === l.toUpperCase() && l.length < 20 && !/\d/.test(l)) return false;
            return true;
          }) || '';
        }

        // ── Company name (bold/strong or secondary line after dealer name) ───
        const companyEl = [...card.querySelectorAll('strong,b,[class*="company"],[class*="firm-name"],[class*="org"]')]
          .find(el => {
            const t = el.textContent.trim();
            return t && t !== dealerName && t.length > 2 && t.length < 200;
          });
        const companyName = companyEl?.textContent.trim().split('\n')[0].trim() || '';

        // ── Address: every remaining line that looks like location text ──────
        const cardText    = card.innerText || '';
        const allLines    = cardText.split('\n').map(l => l.trim()).filter(Boolean);
        const emailSet    = new Set(emails.map(e => e.toLowerCase()));
        const phoneDigits = new Set(phones.map(p => p.replace(/\D/g,'')));

        const addrLines = allLines.filter(l => {
          if (!l || l.length < 3 || l.length > 250) return false;
          if (l === dealerName || l === companyName) return false;
          if (emailSet.has(l.toLowerCase()) || EMAIL_RX.test(l)) return false;
          const d = l.replace(/\D/g,'');
          if (d.length >= 7 && (phoneDigits.has(d) || (PURE_PHONE.test(l) && d.length >= 7))) return false;
          if (SKIP_LINE.test(l.trim()) && l.length < 60) return false;
          if (BTN_ONLY.test(l.trim())) return false;
          if (l === l.toUpperCase() && l.length < 20 && !/\d/.test(l)) return false;
          // Keep lines that look like address content
          const hasDigit  = /\d/.test(l);
          const hasLetter = /[A-Za-z]/.test(l);
          const hasComma  = l.includes(',');
          return (hasDigit && hasLetter) || hasComma || l.length > 20;
        });
        const address = addrLines.join(', ');

        // ── Rating ───────────────────────────────────────────────────────────
        let rating = null;
        const rEl = card.querySelector('[class*="rating"],[class*="star"],[data-rating],[class*="review-score"]');
        if (rEl) {
          const rv = rEl.getAttribute('data-rating') || (rEl.textContent.match(/[\d.]+/) || [])[0];
          if (rv) rating = parseFloat(rv);
        }
        if (!rating) { const m = cardText.match(/(\d+\.?\d*)\s*\/\s*5/); if (m) rating = parseFloat(m[1]); }

        // ── Status ──────────────────────────────────────────────────────────
        const clo = cardText.toLowerCase();
        let status = '';
        if (/open\s*now/.test(clo)) status = 'Open Now';
        else if (/\bclosed\b/.test(clo)) status = 'Closed';

        // ── Website: prefer explicit WEBSITE button, then external link ─────
        const aLinks = [...card.querySelectorAll('a[href^="http"],a[href^="//"]')];
        const websiteBtn  = aLinks.find(a => /^website$|visit website/i.test((a.textContent||'').trim()));
        const externalLnk = aLinks.find(a => {
          const h = a.href.toLowerCase();
          return !['google','facebook','twitter','instagram','youtube','linkedin','maps','goo.gl',window.location.hostname].some(d => h.includes(d));
        });
        const website = websiteBtn?.href || externalLnk?.href || '';

        // ── Services / tags ─────────────────────────────────────────────────
        const services = [...new Set(
          [...card.querySelectorAll('button,[class*="service"],[class*="tag"],[class*="badge"],[class*="label"],[class*="pill"],[class*="type"]')]
            .map(el => el.textContent.trim())
            .filter(t => t.length >= 3 && t.length <= 40 &&
              !/^(read|get|view|book|call|find|visit|show|click|more|open|close|map|dir|review|connect|website|load|direction|know|enquir|inquir)/i.test(t))
        )].slice(0, 10);

        // ── Detail page link (for deep scrape) ──────────────────────────────
        const detailLink = [...card.querySelectorAll('a[href]')]
          .find(a => {
            const txt = (a.textContent || '').trim().toLowerCase();
            const href = a.href || '';
            return (
              (/more info|details?|view profile|read more|know more/i.test(txt) ||
               /dealer\/|dealership\/|showroom\//i.test(href))
              && href.startsWith('http') && !href.includes('google') && !href.includes('maps')
            );
          })?.href || '';

        // ── Google Maps link ────────────────────────────────────────────────
        const mapsLink = [...card.querySelectorAll('a[href]')]
          .find(a => /maps\.google|google\.com\/maps|maps\.app/i.test(a.href || ''))?.href || '';

        return { dealerName, companyName, emails, phones, address, rating, status, services, website, detailLink, mapsLink };
      }

      // ── Shared: walk up from contact element to find card ancestor ──────────
      // Relaxed: headings preferred but not required
      function upToCard(el) {
        let node = el.parentElement;
        let fallback = null;
        for (let d = 0; d < 14 && node && node !== document.body; d++) {
          const txt  = node.innerText || '';
          const lines = txt.split('\n').filter(l => l.trim().length >= 2);
          if (lines.length < 2 || txt.length < 25) { node = node.parentElement; continue; }

          const hasHeading = !!node.querySelector('h1,h2,h3,h4,h5,h6');
          const r = node.getBoundingClientRect();
          const sizeOk = r.width >= 120 && txt.length <= 8000;

          if (hasHeading && sizeOk) return node;             // best: heading-based card
          if (!hasHeading && sizeOk && r.height <= 800 && lines.length >= 3 && !fallback)
            fallback = node;                                  // fallback: size-based card
          node = node.parentElement;
        }
        return fallback;
      }

      // ── Strategy 1: mailto / tel links ──────────────────────────────────────
      function s1() {
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

      // ── Strategy 2: plain-text email node → walk up to card ─────────────────
      function s2() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new WeakSet(), results = [];
        let n;
        while ((n = walker.nextNode())) {
          if (!EMAIL_RX.test(n.textContent)) continue;
          const card = upToCard(n.parentElement);
          if (!card || seen.has(card)) continue;
          seen.add(card);
          const emails = getEmails(card), phones = getPhones(card);
          const data = buildCard(card, emails, phones);
          if (data.dealerName || emails.length || phones.length) results.push({ ...data, state });
        }
        return results.length >= 2 ? results : null;
      }

      // ── Strategy 3: repeated CSS class + email OR phone (NO heading required)
      function s3() {
        const classMap = {};
        for (const el of document.querySelectorAll('div,li,article,section')) {
          const cls = (typeof el.className === 'string' ? el.className : '').trim();
          if (!cls) continue;
          const txt = el.innerText || '';
          if (txt.length < 30 || txt.length > 8000) continue;
          const hasEmail = EMAIL_RX.test(txt);
          const hasPhone = txt.split('\n').some(l => { const d = l.trim().replace(/\D/g,''); return d.length >= 7 && d.length <= 15; });
          if (!hasEmail && !hasPhone) continue;
          if (!classMap[cls]) classMap[cls] = [];
          classMap[cls].push(el);
        }
        const candidates = Object.entries(classMap)
          .filter(([, els]) => els.length >= 2)
          .sort(([, a], [, b]) => {
            if (b.length !== a.length) return b.length - a.length;
            const avgA = a.reduce((s,e) => s + (e.innerText||'').length, 0) / a.length;
            const avgB = b.reduce((s,e) => s + (e.innerText||'').length, 0) / b.length;
            return avgA - avgB;
          });
        for (const [, els] of candidates) {
          const seen = new WeakSet(), results = [];
          for (const card of els) {
            if (seen.has(card)) continue;
            seen.add(card);
            const emails = getEmails(card), phones = getPhones(card);
            if (!emails.length && !phones.length) continue;
            const data = buildCard(card, emails, phones);
            if (data.dealerName) results.push({ ...data, state });
          }
          if (results.length >= 2) return results;
        }
        return null;
      }

      // ── Strategy 4: homogeneous siblings — same tag, multiple contact items ─
      function s4() {
        for (const parent of document.querySelectorAll('div,ul,section,main,ol')) {
          const kids = [...parent.children].filter(c => {
            if (['SCRIPT','STYLE','HEADER','FOOTER','NAV','HEAD'].includes(c.tagName)) return false;
            const txt = c.innerText || '';
            return txt.length >= 30 && txt.length <= 8000;
          });
          if (kids.length < 2) continue;

          // Group by tag
          const byTag = {};
          for (const k of kids) { if (!byTag[k.tagName]) byTag[k.tagName] = []; byTag[k.tagName].push(k); }
          const group = Object.values(byTag).sort((a, b) => b.length - a.length)[0];
          if (!group || group.length < 2) continue;

          const withContact = group.filter(c => {
            const txt = c.innerText || '';
            const hasEmail = EMAIL_RX.test(txt);
            const hasPhone = txt.split('\n').some(l => { const d = l.trim().replace(/\D/g,''); return d.length >= 7 && d.length <= 15; });
            return hasEmail || hasPhone;
          });
          if (withContact.length < 2) continue;

          const seen = new WeakSet(), results = [];
          for (const card of withContact) {
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

      const r1 = s1(); if (r1) return { results: r1, strategy: 1 };
      const r2 = s2(); if (r2) return { results: r2, strategy: 2 };
      const r3 = s3(); if (r3) return { results: r3, strategy: 3 };
      const r4 = s4(); if (r4) return { results: r4, strategy: 4 };
      return null;
    }, stateName);

    if (results) {
      log(`  → detectListings: strategy ${results.strategy} found ${results.results.length} cards`);
      return results.results;
    }
    log(`  → detectListings: all strategies failed — dumping page info`);
    await this.dumpPageInfo(page);
    return null;
  }

  // ── Detect state/city filters ─────────────────────────────────────────────
  async detectFilters(page) {
    log('  → detectFilters...');
    const filters = await page.evaluate(() => {
      const f = {};
      for (const sel of document.querySelectorAll('select')) {
        const labelEl = sel.id ? document.querySelector(`label[for="${sel.id}"]`) : null;
        const hint = (
          labelEl?.textContent || sel.previousElementSibling?.textContent ||
          sel.getAttribute('aria-label') || sel.getAttribute('placeholder') ||
          sel.getAttribute('name') || sel.getAttribute('id') || ''
        ).toLowerCase().trim();
        const skipVals = new Set(['','--','select state','all states','choose state','any state','select','all','choose','any','0','-1']);
        const opts = [...sel.options]
          .map(o => ({ value: o.value, label: o.text.trim() }))
          .filter(o => o.value && !skipVals.has(o.label.toLowerCase()) && !skipVals.has(o.value));
        if (opts.length >= 2 && /state|province|region/.test(hint)) {
          f.type = 'dropdown'; f.stateOptions = opts;
          f.stateSelector = sel.name || sel.id || '';
          f.stateSelectorCSS = sel.name ? `select[name="${sel.name}"]` : sel.id ? `select#${sel.id}` : 'select';
          break;
        }
      }
      if (f.type === 'dropdown') {
        const btn = [...document.querySelectorAll('button,input[type="submit"],input[type="button"]')]
          .find(el => /search|find|go|submit|dealer/i.test((el.textContent || el.value || '').trim()));
        if (btn) {
          f.searchSelector = btn.id ? `#${btn.id}`
            : btn.name ? `[name="${btn.name}"]`
            : btn.className ? `.${btn.className.trim().split(/\s+/)[0]}`
            : 'button[type="submit"]';
        }
      }
      if (!f.type) {
        const navLinks = [...document.querySelectorAll(
          '[class*="state"] a,[class*="region"] a,[id*="state"] a,[class*="location-nav"] a,nav a'
        )].map(a => ({ label: (a.textContent||'').trim(), href: a.href }))
          .filter(l => l.label && l.href && l.label.length < 60 && l.href.startsWith('http') && !l.href.includes('#'));
        if (navLinks.length >= 5) { f.type = 'links'; f.stateLinks = navLinks; }
      }
      return f.type ? f : null;
    });
    if (filters) log(`  → detectFilters: type="${filters.type}", ${filters.stateOptions?.length || filters.stateLinks?.length || 0} options`);
    else          log('  → detectFilters: none found');
    return filters;
  }

  // ── Deep scrape: visit each dealer's own website ───────────────────────────
  async deepScrapeCard(lead, onProgress) {
    const target = lead.detailLink || lead.website;
    if (!target || target === lead.sourceUrl) return lead;
    // Don't scrape Google, social media, maps
    if (/google|facebook|instagram|twitter|maps\.app|linkedin|youtube/i.test(target)) return lead;
    if (lead.deepScraped) return lead;

    log(`  → deepScrapeCard: ${target}`);
    onProgress?.(`  Deep scanning ${lead.dealerName}...`);
    const page = await this.openPage();
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));
      const html = await page.content();
      const text = await page.evaluate(() => {
        document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
        return document.body?.innerText || '';
      });
      await page.close();

      const $         = cheerio.load(html);
      const extraEmails = this.extractEmails(html, text);
      const extraPhones = this.extractPhonesFromText(text);
      const social      = this.extractSocialMedia($);
      const structured  = this.extractStructuredData($);

      return {
        ...lead,
        emails:       [...new Set([...lead.emails, ...extraEmails])].slice(0, 10),
        phones:       [...new Set([...lead.phones, ...extraPhones])].slice(0, 8),
        email:        lead.email || extraEmails[0] || '',
        phone:        lead.phone || extraPhones[0] || '',
        address:      lead.address || structured.address || '',
        socialMedia:  Object.keys(social).length ? social : undefined,
        openingHours: lead.openingHours || structured.openingHours || '',
        description:  lead.description  || structured.description  || '',
        deepScraped:  true,
      };
    } catch (err) {
      log(`  → deepScrapeCard FAILED for ${lead.dealerName}: ${err.message}`);
      await page.close().catch(() => {});
      return lead;
    }
  }

  // ── Run deep scrape on a batch of leads (limited concurrency) ──────────────
  async deepScrapeLeads(leads, onProgress) {
    log(`  → deepScrapeLeads: ${leads.length} leads, concurrency=3`);
    const results = new Array(leads.length);
    const CONCURRENCY = 3;
    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      const chunk = leads.slice(i, i + CONCURRENCY);
      const done  = await Promise.all(
        chunk.map(lead => this.deepScrapeCard(lead, onProgress).catch(() => lead))
      );
      done.forEach((l, j) => { results[i + j] = l; });
    }
    return results;
  }

  // ── Scrape via dropdown: select state → SEARCH → extract ─────────────────
  async scrapeStateWithDropdown(url, stateOption, cssSelector, searchSelector, onProgress, deepMode = false) {
    const label = stateOption.label;
    log(`[${label}] scrapeStateWithDropdown (deepMode=${deepMode})`);
    onProgress?.(`Navigating to site...`);

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, url);

      // Select state
      log(`[${label}] Selecting state: value="${stateOption.value}" css="${cssSelector}"`);
      onProgress?.(`Selecting state: ${label}`);
      const selected = await page.evaluate((css, val) => {
        const el = document.querySelector(css);
        if (!el) return `NOT_FOUND (${css})`;
        el.value = val;
        ['input','change'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
        return `OK (${el.tagName}[value="${val}"])`;
      }, cssSelector, stateOption.value);
      log(`[${label}] Select result: ${selected}`);

      await new Promise(r => setTimeout(r, 1500));

      // Click SEARCH — wait for navigation or AJAX settle
      log(`[${label}] Clicking SEARCH (selector="${searchSelector}")`);
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
        return (btn.textContent?.trim() || btn.value || 'clicked').slice(0, 40);
      }, searchSelector || '');
      log(`[${label}] SEARCH click: "${clicked}"`);
      await navPromise;
      log(`[${label}] Page settled after SEARCH`);

      // Extra wait + wait for cards to appear
      await new Promise(r => setTimeout(r, 2000));
      await this.waitForCards(page, 10000);
      onProgress?.(`Loading results...`);
      await this.scrollPage(page);

      // LOAD MORE
      onProgress?.(`Checking for LOAD MORE...`);
      await this.clickLoadMore(page, onProgress);

      // Extract
      onProgress?.(`Extracting dealer cards...`);
      const rawListings = await this.detectListings(page, label);
      await page.close();

      if (!rawListings || !rawListings.length) {
        log(`[${label}] No listings found`);
        onProgress?.(`No listings found for ${label}`);
        return [];
      }

      log(`[${label}] Extracted ${rawListings.length} dealers (deepMode=${deepMode})`);
      onProgress?.(`Extracted ${rawListings.length} dealers`);

      let leads = rawListings.map(item => normaliseLead(item, { state: label, sourceUrl: url }));

      // Deep scrape: visit each dealer's website for extra data
      if (deepMode) {
        onProgress?.(`Deep scanning ${leads.length} dealer websites...`);
        leads = await this.deepScrapeLeads(leads, onProgress);
        log(`[${label}] Deep scrape done`);
      }

      return leads;
    } catch (err) {
      log(`[${label}] ERROR: ${err.message}`);
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Scrape one state page (link-based navigation) ─────────────────────────
  async scrapeStatePage(stateLink, onProgress, deepMode = false) {
    const label = stateLink.label;
    log(`[${label}] scrapeStatePage: ${stateLink.href} (deepMode=${deepMode})`);
    onProgress?.(`Navigating to ${stateLink.href}`);

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, stateLink.href);
      await this.waitForCards(page, 8000);
      onProgress?.(`Clicking LOAD MORE if present...`);
      await this.clickLoadMore(page, onProgress);
      onProgress?.(`Extracting dealer cards...`);
      const rawListings = await this.detectListings(page, label);
      await page.close();

      if (!rawListings || !rawListings.length) { log(`[${label}] No listings`); return []; }
      log(`[${label}] Extracted ${rawListings.length} dealers`);

      let leads = rawListings.map(item => normaliseLead(item, { state: label, sourceUrl: stateLink.href }));
      if (deepMode) {
        onProgress?.(`Deep scanning ${leads.length} dealer websites...`);
        leads = await this.deepScrapeLeads(leads, onProgress);
      }
      return leads;
    } catch (err) {
      log(`[${label}] ERROR: ${err.message}`);
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Scrape a single URL — returns { leads, filters } ─────────────────────
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
        return {
          leads: rawListings.map(item => ({ ...normaliseLead(item, { sourceUrl: url }), isListingItem: true })),
          filters: null,
        };
      }

      // No listings found — check for filter/search forms
      log('scrapeUrl: no listings, checking for filters...');
      const filters = await this.detectFilters(page);
      if (filters) {
        log(`scrapeUrl: filter page detected (type=${filters.type})`);
        await page.close();
        return { leads: [], filters };
      }

      // Single business fallback
      log('scrapeUrl: single-business fallback');
      const html = await page.content();
      const text = await page.evaluate(() => {
        document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
        return document.body?.innerText || '';
      });
      await page.close();

      const $ = cheerio.load(html);
      const meta = this.extractMeta($), structured = this.extractStructuredData($);
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
            const ss = this.extractSocialMedia($s), sd = this.extractStructuredData($s);
            Object.keys(ss).forEach(k => { if (!social[k]) social[k] = ss[k]; });
            if (!structured.address && sd.address)          structured.address      = sd.address;
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
          state: structured.state || '', dealerName: businessName, companyName: '',
          city: structured.city || city || '', locality, pinCode: structured.postalCode || pinCode || '',
          address: structured.address || '',
          phone: phones[0] || '', phones: phones.slice(0, 8),
          email: emails[0] || '', emails: emails.slice(0, 10),
          rating: null, status: '', services: [], website: url,
          socialMedia: social,
          description: structured.description || meta.description || '',
          openingHours: structured.openingHours || '',
          sourceUrl: url, isListingItem: false, pagesScraped,
          scrapedAt: new Date().toISOString(),
        }],
        filters: null,
      };
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ── Quick analyze: detect filters only ───────────────────────────────────
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
    const kw     = ['contact','about','team','reach','connect','location','support'];
    const links  = new Set();
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
