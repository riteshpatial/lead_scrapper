const express = require('express');
const router = express.Router();
const LeadScraper = require('../scrapers/leadScraper');

// ── POST /api/scrape ─────────────────────────────────────────────────────────
// Scrape one or more URLs. Auto-detects listing pages vs single business.
router.post('/scrape', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ error: 'Provide an array of URLs.' });

  const scraper = new LeadScraper();
  try {
    await scraper.init();
    const results = [];
    for (const url of urls.slice(0, 10)) {
      try {
        const leads = await scraper.scrapeUrl(url.trim());
        leads.forEach(l => results.push({ ...l, _status: 'success' }));
      } catch (err) {
        console.error(`scrape error [${url}]:`, err.message);
        results.push({ sourceUrl: url, _status: 'error', error: err.message });
      }
    }
    res.json({ success: true, results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await scraper.close();
  }
});

// ── POST /api/analyze ────────────────────────────────────────────────────────
// Fast: detect state/city filter links on the page without a full scrape.
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

// ── POST /api/scrape-states-stream ───────────────────────────────────────────
// SSE stream: scrapes each state page one-by-one and pushes results live.
// Fixes the 29-state timeout — client receives data as each state finishes.
router.post('/scrape-states-stream', async (req, res) => {
  const { stateLinks } = req.body;
  if (!stateLinks || !stateLinks.length)
    return res.status(400).json({ error: 'Provide stateLinks array.' });

  // SSE headers — keep connection alive for as long as scraping takes
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = obj => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // Keep-alive ping every 20s so the connection doesn't drop
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20000);

  const scraper = new LeadScraper();
  let totalLeads = 0;

  try {
    await scraper.init();

    for (let i = 0; i < stateLinks.length; i++) {
      if (res.writableEnded) break; // client disconnected

      const link = stateLinks[i];
      send({ type: 'start', state: link.label, index: i + 1, total: stateLinks.length });

      try {
        const leads = await scraper.scrapeStatePage(link);
        totalLeads += leads.length;
        send({ type: 'result', state: link.label, leads, count: leads.length, totalSoFar: totalLeads });
      } catch (err) {
        console.error(`state scrape failed [${link.label}]:`, err.message);
        send({ type: 'error', state: link.label, error: err.message });
      }
    }

    send({ type: 'done', totalLeads });
  } catch (err) {
    send({ type: 'fatal', error: err.message });
  } finally {
    clearInterval(ping);
    await scraper.close();
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
