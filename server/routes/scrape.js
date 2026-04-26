const express = require('express');
const router  = express.Router();
const LeadScraper = require('../scrapers/leadScraper');

// ── POST /api/scrape ──────────────────────────────────────────────────────────
// Returns { success, results, total, filters }
// `filters` is populated when the page is a search/filter form (no listings).
router.post('/scrape', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ error: 'Provide an array of URLs.' });

  const scraper = new LeadScraper();
  let allFilters = null;
  try {
    await scraper.init();
    const results = [];
    for (const url of urls.slice(0, 10)) {
      try {
        const { leads, filters } = await scraper.scrapeUrl(url.trim());
        leads.forEach(l => results.push({ ...l, _status: 'success' }));
        if (filters && !allFilters) allFilters = filters;
      } catch (err) {
        console.error(`scrape error [${url}]:`, err.message);
        results.push({ sourceUrl: url, _status: 'error', error: err.message });
      }
    }
    res.json({ success: true, results, total: results.length, filters: allFilters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await scraper.close();
  }
});

// ── POST /api/analyze ─────────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Provide a URL.' });
  const scraper = new LeadScraper();
  try {
    await scraper.init();
    const info = await scraper.analyzeUrl(url.trim());
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await scraper.close();
  }
});

// ── POST /api/scrape-states-stream ────────────────────────────────────────────
// SSE stream — supports link-based AND dropdown-based state scraping.
//
// Link payload:     { stateLinks: [{label, href},...] }
// Dropdown payload: { type:'dropdown', url, stateSelector, stateSelectorCSS,
//                     searchSelector, stateOptions:[{value,label},...] }
//
// SSE event types:
//   { type:'start',    state, index, total }
//   { type:'progress', state, msg }           ← granular step updates
//   { type:'result',   state, leads, count, totalSoFar }
//   { type:'error',    state, error }
//   { type:'done',     totalLeads }
//   { type:'fatal',    error }
router.post('/scrape-states-stream', async (req, res) => {
  const {
    type, stateLinks, stateOptions,
    url, stateSelector, stateSelectorCSS, searchSelector,
  } = req.body;

  const isDropdown = type === 'dropdown';
  const items      = isDropdown ? stateOptions : stateLinks;

  if (!items || !items.length)
    return res.status(400).json({ error: 'Provide stateLinks or stateOptions array.' });
  if (isDropdown && !url)
    return res.status(400).json({ error: 'Provide url for dropdown-type scraping.' });

  // SSE setup
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = obj => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);

  const scraper    = new LeadScraper();
  let totalLeads   = 0;

  try {
    await scraper.init();

    for (let i = 0; i < items.length; i++) {
      if (res.writableEnded) break;

      const item  = items[i];
      const label = item.label || item.href || `Item ${i + 1}`;

      send({ type: 'start', state: label, index: i + 1, total: items.length });
      console.log(`[stream] [${i+1}/${items.length}] Starting: ${label}`);

      // progress callback → sent as SSE 'progress' events
      const onProgress = msg => send({ type: 'progress', state: label, msg });

      try {
        const t0 = Date.now();
        let leads;

        if (isDropdown) {
          leads = await scraper.scrapeStateWithDropdown(
            url, item,
            stateSelectorCSS || stateSelector,
            searchSelector,
            onProgress,
          );
        } else {
          leads = await scraper.scrapeStatePage(item, onProgress);
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        totalLeads += leads.length;
        console.log(`[stream] [${i+1}/${items.length}] Done: ${label} → ${leads.length} leads (${elapsed}s)`);
        send({ type: 'result', state: label, leads, count: leads.length, totalSoFar: totalLeads });
      } catch (err) {
        console.error(`[stream] [${i+1}/${items.length}] FAILED: ${label} — ${err.message}`);
        send({ type: 'error', state: label, error: err.message });
      }
    }

    send({ type: 'done', totalLeads });
    console.log(`[stream] Done. Total leads: ${totalLeads}`);
  } catch (err) {
    send({ type: 'fatal', error: err.message });
    console.error('[stream] FATAL:', err.message);
  } finally {
    clearInterval(ping);
    await scraper.close();
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
