const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
const IGNORE_EMAIL_DOMAINS = ['example.com', 'test.com', 'domain.com', 'yourdomain.com', 'sentry.io', 'wixpress.com', 'w3.org'];
const IGNORE_EMAIL_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'bounce'];
const IGNORE_EMAIL_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.css', '.js', '.webp', '.ico'];

const SOCIAL_PATTERNS = [
  { key: 'facebook',  regex: /facebook\.com\/(?!sharer|share|login|dialog|photo|video|groups|hashtag|messages|watch|reel)([^/?#\s"']{2,})/i },
  { key: 'twitter',   regex: /(?:twitter|x)\.com\/(?!intent|share|home|search)([a-zA-Z0-9_]{1,50})/i },
  { key: 'linkedin',  regex: /linkedin\.com\/(company|in|school)\/([a-zA-Z0-9\-_.]{1,})/i },
  { key: 'instagram', regex: /instagram\.com\/(?!p\/|explore\/|accounts\/)([a-zA-Z0-9_.]{1,50})/i },
  { key: 'youtube',   regex: /youtube\.com\/(channel|user|c|@)\/([a-zA-Z0-9\-_]{1,})/i },
];

const ORG_TYPES = ['LocalBusiness','Organization','Corporation','Store','Restaurant','Hotel','MedicalBusiness','ProfessionalService'];

// ─── Address parser (works for Indian + generic addresses) ──────────────────
function parseAddress(raw) {
  if (!raw) return { pinCode: '', city: '', locality: '' };
  const text = raw.replace(/\s+/g, ' ').trim();

  // Indian 6-digit PIN
  const pin6 = text.match(/\b(\d{6})\b/);
  // US/generic 5-digit ZIP
  const pin5 = !pin6 && text.match(/\b(\d{5})\b/);
  const pinCode = (pin6 || pin5 || [])[1] || '';

  let city = '', locality = '';
  // Split on common address delimiters
  const parts = text.replace(/[-–]/g, ',').split(',').map(p => p.trim()).filter(p => p.length > 1);

  if (pinCode) {
    // Find which segment contains the PIN
    const pinIdx = parts.findIndex(p => p.includes(pinCode));
    if (pinIdx > 0) {
      locality = parts[pinIdx - 1] || '';
      city     = parts[pinIdx - 2] || '';
    } else if (pinIdx === 0 && parts.length > 1) {
      city = parts[1] || '';
    }
    // Sometimes city comes after PIN in Indian addresses
    if (!city && pinIdx >= 0 && parts[pinIdx + 1]) {
      city = parts[pinIdx + 1];
    }
  } else if (parts.length >= 2) {
    locality = parts[parts.length - 1];
    city     = parts[parts.length - 2] || '';
  }

  // Strip digits-only junk
  if (/^\d+$/.test(city))     city     = '';
  if (/^\d+$/.test(locality)) locality = '';

  return { pinCode, city: city.slice(0, 60), locality: locality.slice(0, 80) };
}

class LeadScraper {
  constructor() { this.browser = null; }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--disable-gpu'],
    });
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  async openPage() {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', r => (['image','font','media'].includes(r.resourceType()) ? r.abort() : r.continue()));
    return page;
  }

  async navigateAndWait(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));
    // Scroll to trigger lazy-loaded cards
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let scrolled = 0;
        const step = 400, max = Math.min(document.body.scrollHeight, 12000);
        const t = setInterval(() => {
          window.scrollBy(0, step); scrolled += step;
          if (scrolled >= max) { clearInterval(t); window.scrollTo(0, 0); resolve(); }
        }, 120);
      });
    });
    await new Promise(r => setTimeout(r, 1200));
  }

  // ─── CORE: Extract every listing card on the page ──────────────────────────
  async detectListings(page, stateName = '') {
    return await page.evaluate((state) => {
      // Walk up DOM to find the card container that holds a heading + contact
      function getCard(el) {
        let node = el.parentElement;
        for (let d = 0; d < 15 && node; d++) {
          const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
          if (heading) {
            const rect = node.getBoundingClientRect();
            const hasContact = node.querySelector('a[href^="mailto:"],a[href^="tel:"]');
            if (hasContact && rect.height >= 60 && rect.height <= window.innerHeight * 0.96 && rect.width >= 120) return node;
          }
          node = node.parentElement;
        }
        return null;
      }

      function extractCard(card) {
        // ── Dealer / Business name (primary heading) ──
        const headings = [...card.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const dealerName = headings.map(h => h.textContent.trim()).find(t => t.length > 0) || '';

        // ── Company name (bold/strong, different from dealer name) ──
        const companyName = [...card.querySelectorAll('strong,b')]
          .map(el => el.textContent.trim())
          .find(t => t && t !== dealerName && t.length > 2 && t.length < 200) || '';

        // ── Emails ──
        const emails = [...new Set(
          [...card.querySelectorAll('a[href^="mailto:"]')]
            .map(a => a.href.replace('mailto:', '').split('?')[0].trim().toLowerCase())
            .filter(e => e.includes('@') && e.includes('.'))
        )];

        // ── Phones (prefer visible text of tel: links) ──
        const phones = [...new Set(
          [...card.querySelectorAll('a[href^="tel:"]')]
            .map(a => {
              const txt = (a.innerText || a.textContent || '').replace(/\s+/g,' ').trim();
              const href = a.href.replace('tel:','').trim();
              return (txt && /\d{5,}/.test(txt)) ? txt : href;
            })
            .filter(p => p && p.replace(/\D/g,'').length >= 7)
        )];

        // ── Full address ──
        let address = '';
        const addrEl = card.querySelector('address,[class*="address"],[class*="addr"],[class*="location"],[class*="loc-"]');
        if (addrEl) address = (addrEl.innerText || addrEl.textContent || '').replace(/\s+/g,' ').trim();

        if (!address) {
          // Walk text nodes looking for address-like content
          const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
          const cands = [];
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent.replace(/\s+/g,' ').trim();
            if (t.length > 8 && t.length < 300 && !t.includes('@') && /[A-Za-z]/.test(t) && /\d/.test(t) && !/^\+?[\d\s\-()+.]{7,}$/.test(t)) {
              cands.push(t);
            }
          }
          address = cands.find(t =>
            /\b(road|street|rd|st|plot|sector|phase|nagar|marg|block|floor|building|area|colony|near|opp|opposite|lane|village|ward|district|indl|industrial|pvt|ltd)\b/i.test(t)
            || (t.includes(',') && /\d/.test(t))
          ) || cands[0] || '';
        }

        // ── Rating ──
        const ratingEl = card.querySelector('[class*="rating"],[class*="star"],[data-rating]');
        let rating = null;
        if (ratingEl) {
          const rv = ratingEl.getAttribute('data-rating') || (ratingEl.textContent.match(/[\d.]+/) || [])[0];
          rating = rv ? parseFloat(rv) : null;
        }

        // ── Open / Closed status ──
        const cardText = (card.innerText || '').toLowerCase();
        let status = '';
        if (/open\s*now/.test(cardText)) status = 'Open Now';
        else if (/\bclosed\b/.test(cardText) || /opens\s+(at|tomorrow|on)/.test(cardText)) status = 'Closed';

        // ── Website URL — look for "WEBSITE" button first ──
        const allLinks = [...card.querySelectorAll('a[href^="http"],a[href^="//"]')];
        const websiteBtn = allLinks.find(a => /^website$|visit website|official site/i.test((a.textContent||'').trim()));
        const externalLink = allLinks.find(a => {
          const h = a.href.toLowerCase();
          return !['google','facebook','twitter','instagram','youtube','linkedin','maps','goo.gl',window.location.hostname]
            .some(d => h.includes(d));
        });
        const website = websiteBtn?.href || externalLink?.href || '';

        // ── Services / tags (SALES, SERVICE, SPARES, etc.) ──
        const services = [...new Set(
          [...card.querySelectorAll('button,[class*="service"],[class*="tag"],[class*="badge"],[class*="label"],[class*="type"],[class*="pill"]')]
            .map(el => el.textContent.trim())
            .filter(t => t.length >= 2 && t.length <= 30 && /^[A-Z]/.test(t)
              && !/^(READ|GET|VIEW|BOOK|CALL|FIND|VISIT|SHOW|CLICK|MORE|OPEN|CLOSE|MAP|DIR|REVIEW|CONNECT|EXPERT|WEBSITE)/i.test(t))
        )].slice(0, 8);

        return { dealerName, companyName, emails, phones, address, rating, status, services, website };
      }

      // Gather all elements that have a mailto: or tel: link
      const contactEls = [
        ...document.querySelectorAll('a[href^="mailto:"]'),
        ...document.querySelectorAll('a[href^="tel:"]'),
      ];
      if (contactEls.length < 2) return null;

      const seen = new WeakSet();
      const results = [];
      for (const el of contactEls) {
        const card = getCard(el);
        if (!card || seen.has(card)) continue;
        seen.add(card);
        const data = extractCard(card);
        if (data.dealerName || data.emails.length || data.phones.length) {
          results.push({ ...data, state });
        }
      }
      return results.length >= 2 ? results : null;
    }, stateName);
  }

  // ─── Detect state/city navigation links on the page ──────────────────────
  async detectFilters(page) {
    return await page.evaluate(() => {
      const filters = {};

      // <select> dropdowns
      for (const sel of document.querySelectorAll('select')) {
        const labelEl = document.querySelector(`label[for="${sel.id}"]`);
        const hint = (
          labelEl?.textContent ||
          sel.previousElementSibling?.textContent ||
          sel.getAttribute('aria-label') ||
          sel.getAttribute('name') ||
          sel.getAttribute('id') || ''
        ).toLowerCase();
        const opts = [...sel.options]
          .map(o => ({ value: o.value, label: o.text.trim() }))
          .filter(o => o.value && !['', 'select','--','all','choose','any'].some(d => o.label.toLowerCase().startsWith(d)));
        if (opts.length >= 2) {
          if (/state|province|region/.test(hint))       filters.states = { options: opts, selector: sel.name || sel.id };
          else if (/city|town|district|area/.test(hint)) filters.cities = { options: opts, selector: sel.name || sel.id };
        }
      }

      // <a>-based state navigation (e.g. Honda-style link list)
      const navLinks = [...document.querySelectorAll(
        '[class*="state"] a, [class*="region"] a, [id*="state"] a, [id*="region"] a, [class*="location-nav"] a, [class*="city-list"] a, nav a'
      )]
        .map(a => ({ label: (a.textContent||'').trim(), href: a.href }))
        .filter(l => l.label && l.href && l.label.length < 60 && l.href.startsWith('http')
          && !l.href.includes('#') && !l.href.includes('javascript'));

      if (navLinks.length >= 5) filters.stateLinks = navLinks;

      return Object.keys(filters).length ? filters : null;
    });
  }

  // ─── Scrape one state/filter page → returns simplified lead rows ──────────
  async scrapeStatePage(stateLink) {
    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, stateLink.href);
      const rawListings = await this.detectListings(page, stateLink.label);
      await page.close();
      if (!rawListings || !rawListings.length) return [];

      return rawListings.map((item, i) => {
        const { pinCode, city, locality } = parseAddress(item.address);
        return {
          state:       item.state || stateLink.label || '',
          dealerName:  item.dealerName || item.companyName || `Dealer ${i + 1}`,
          companyName: item.companyName || '',
          city:        item.city || city || '',
          locality:    item.locality || locality || '',
          pinCode:     item.pinCode || pinCode || '',
          address:     item.address || '',
          phone:       item.phones[0] || '',
          phones:      item.phones,
          email:       item.emails[0] || '',
          emails:      item.emails,
          rating:      item.rating ?? null,
          status:      item.status || '',
          services:    item.services || [],
          website:     item.website || '',
          sourceUrl:   stateLink.href,
          scrapedAt:   new Date().toISOString(),
        };
      });
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ─── Scrape a single arbitrary URL (listing page or single business) ───────
  async scrapeUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

    const page = await this.openPage();
    try {
      await this.navigateAndWait(page, url);

      // Try listing detection first
      const rawListings = await this.detectListings(page);
      if (rawListings && rawListings.length >= 2) {
        await page.close();
        return rawListings.map((item, i) => {
          const { pinCode, city, locality } = parseAddress(item.address);
          return {
            state:       item.state || '',
            dealerName:  item.dealerName || item.companyName || `Listing ${i + 1}`,
            companyName: item.companyName || '',
            city:        item.city || city || '',
            locality:    item.locality || locality || '',
            pinCode:     item.pinCode || pinCode || '',
            address:     item.address || '',
            phone:       item.phones[0] || '',
            phones:      item.phones,
            email:       item.emails[0] || '',
            emails:      item.emails,
            rating:      item.rating ?? null,
            status:      item.status || '',
            services:    item.services || [],
            website:     item.website || '',
            sourceUrl:   url,
            isListingItem: true,
            scrapedAt:   new Date().toISOString(),
          };
        });
      }

      // ── Single business fallback ──────────────────────────────────────────
      const html = await page.content();
      const text = await page.evaluate(() => {
        document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
        return document.body?.innerText || '';
      });
      await page.close();

      const $ = cheerio.load(html);
      const meta = this.extractMeta($);
      const structured = this.extractStructuredData($);
      let emails = this.extractEmails(html, text);
      let phones = this.extractPhonesFromText(text);
      const social = this.extractSocialMedia($);
      if (structured.telephone) phones = [...new Set([structured.telephone, ...phones])];
      if (structured.email)     emails = [...new Set([structured.email, ...emails])];

      // Crawl sub-pages (contact / about)
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
            if (!structured.address && sd.address) structured.address = sd.address;
            if (!structured.businessName && sd.businessName) structured.businessName = sd.businessName;
            pagesScraped++;
          } catch(e) { await sp.close().catch(()=>{}); }
        } catch(_) {}
      }

      const { pinCode, city, locality } = parseAddress(structured.address || '');
      const businessName = structured.businessName || meta.siteName || (meta.title ? meta.title.split(/[|\-–]/)[0].trim() : '') || new URL(url).hostname.replace('www.','');

      return [{
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
      }];
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  // ─── Quick analysis: just detect filters, no full scrape ─────────────────
  async analyzeUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
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

  // ─── Helpers ──────────────────────────────────────────────────────────────
  extractEmails(html, text) {
    const raw = (html + ' ' + text).match(EMAIL_REGEX) || [];
    return [...new Set(raw.map(e => e.toLowerCase().trim()).filter(e => {
      const [pfx, dom] = e.split('@');
      if (!dom) return false;
      if (IGNORE_EMAIL_EXT.some(x => e.endsWith(x))) return false;
      if (IGNORE_EMAIL_DOMAINS.some(d => dom.includes(d))) return false;
      if (IGNORE_EMAIL_PREFIXES.some(p => pfx.startsWith(p))) return false;
      return true;
    }))];
  }

  extractPhonesFromText(text) {
    const PHONE_RE = /(?:\+?(?:\d{1,3})[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
    const raw = text.match(PHONE_RE) || [];
    return [...new Set(raw.map(p => p.trim()).filter(p => {
      const d = p.replace(/\D/g,'');
      return d.length >= 10 && d.length <= 15;
    }))].slice(0, 8);
  }

  extractSocialMedia($) {
    const social = {};
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      for (const { key, regex } of SOCIAL_PATTERNS) {
        if (!social[key] && regex.test(href)) social[key] = href.startsWith('http') ? href : 'https://'+href.replace(/^\/\//,'');
      }
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
            if (item.name)        r.businessName  = r.businessName  || item.name;
            if (item.description) r.description   = r.description   || item.description;
            if (item.telephone)   r.telephone     = r.telephone     || item.telephone;
            if (item.email)       r.email         = r.email         || item.email;
            if (item.openingHours) r.openingHours = Array.isArray(item.openingHours) ? item.openingHours.join(', ') : item.openingHours;
            if (item.address) {
              const a = item.address;
              r.address    = r.address    || (typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(Boolean).join(', '));
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
