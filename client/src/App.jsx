import { useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import ScrapeForm from './components/ScrapeForm';
import FilterPanel from './components/FilterPanel';
import StatsBar from './components/StatsBar';
import LeadCard from './components/LeadCard';
import ExportButtons from './components/ExportButtons';
import TableView from './components/TableView';

export default function App() {
  const [leads, setLeads]                   = useState([]);
  const [loading, setLoading]               = useState(false);
  const [analyzing, setAnalyzing]           = useState(false);
  const [streamActive, setStreamActive]     = useState(false);
  const [error, setError]                   = useState('');
  const [scrapeTime, setScrapeTime]         = useState(null);
  const [view, setView]                     = useState('cards');
  const [detectedFilters, setDetectedFilters] = useState(null);
  const [lastUrl, setLastUrl]               = useState('');
  const [progress, setProgress]             = useState('');   // live status line

  // ── Scrape one or more URLs ────────────────────────────────────────────────
  const handleScrape = async (urls) => {
    setLoading(true);
    setError('');
    setLeads([]);
    setDetectedFilters(null);
    setProgress('');
    setLastUrl(urls[0] || '');
    const t0 = Date.now();
    try {
      const { data } = await axios.post('/api/scrape', { urls });
      setLeads(data.results || []);
      setScrapeTime(((Date.now() - t0) / 1000).toFixed(1));
      // Background: detect state filters on the first URL
      if (urls.length === 1) detectFilters(urls[0]);
    } catch (err) {
      setError(err.response?.data?.error || 'Scraping failed. Is the server running on port 5000?');
    } finally {
      setLoading(false);
    }
  };

  // Background filter detection (runs after the first scrape)
  const detectFilters = async (url) => {
    setAnalyzing(true);
    try {
      const { data } = await axios.post('/api/analyze', { url });
      if (data.filters) setDetectedFilters(data.filters);
    } catch (_) {}
    finally { setAnalyzing(false); }
  };

  // ── SSE streaming: scrape states one-by-one, push leads in real-time ──────
  const handleScrapeStates = async (items, filtersCtx) => {
    setStreamActive(true);
    setError('');
    setLeads([]);
    setProgress(`Starting — 0 / ${items.length} states`);
    const t0 = Date.now();
    const acc = [];
    let done = 0;

    const isDropdown = filtersCtx?.type === 'dropdown';
    const body = isDropdown
      ? {
          type: 'dropdown',
          url: lastUrl,
          stateSelector:    filtersCtx.stateSelector,
          stateSelectorCSS: filtersCtx.stateSelectorCSS,
          searchSelector:   filtersCtx.searchSelector,
          stateOptions:     items,
        }
      : { stateLinks: items };

    try {
      const res = await fetch('/api/scrape-states-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buf += decoder.decode(value, { stream: true });

        // SSE events are separated by \n\n
        const parts = buf.split('\n\n');
        buf = parts.pop();          // keep last incomplete chunk

        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6));

            if (ev.type === 'start') {
              setProgress(`[${ev.index}/${ev.total}] Scraping ${ev.state}...`);
            } else if (ev.type === 'result') {
              done++;
              acc.push(...ev.leads);
              setLeads([...acc]);
              setProgress(`[${done}/${items.length}] ${ev.state}: ${ev.count} dealers — Total: ${ev.totalSoFar}`);
            } else if (ev.type === 'error') {
              done++;
              setProgress(`[${done}/${items.length}] ${ev.state}: failed (${ev.error})`);
            } else if (ev.type === 'done') {
              setScrapeTime(((Date.now() - t0) / 1000).toFixed(0));
              setProgress('');
              setDetectedFilters(null);
              setStreamActive(false);
            } else if (ev.type === 'fatal') {
              throw new Error(ev.error);
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      setError('State scraping failed: ' + err.message);
    } finally {
      setStreamActive(false);
      setProgress('');
    }
  };

  const successLeads  = leads.filter(l => l._status !== 'error');
  const totalEmails   = successLeads.reduce((s, l) => s + (l.emails?.length || 0), 0);
  const totalPhones   = successLeads.reduce((s, l) => s + (l.phones?.length || 0), 0);
  const isListingPage = successLeads.some(l => l.isListingItem);
  const busy          = loading || streamActive;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        <ScrapeForm onScrape={handleScrape} loading={busy} />

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-950 border border-red-700 rounded-xl text-red-300 text-sm">{error}</div>
        )}

        {/* Spinner + live progress */}
        {busy && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm text-center max-w-lg min-h-[1.25rem]">{progress || 'Scraping and extracting leads…'}</p>
            {streamActive && leads.length > 0 && (
              <p className="text-indigo-400 text-xs">{leads.length} leads collected so far</p>
            )}
          </div>
        )}

        {/* State filter panel (shown after first scrape if filters found) */}
        {!busy && detectedFilters && (
          <FilterPanel
            filters={detectedFilters}
            onScrapeStates={handleScrapeStates}
            analyzing={analyzing}
          />
        )}
        {analyzing && !detectedFilters && (
          <p className="text-slate-600 text-xs animate-pulse">Detecting state / city filters…</p>
        )}

        {/* Results */}
        {leads.length > 0 && (
          <>
            <StatsBar
              leadsCount={successLeads.length}
              emailsCount={totalEmails}
              phonesCount={totalPhones}
              scrapeTime={!busy ? scrapeTime : null}
              isListingPage={isListingPage}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-200">
                  {successLeads.length} {isListingPage ? 'Dealer Listings' : 'Leads'} Extracted
                </h2>
                {isListingPage && (
                  <p className="text-xs text-indigo-400 mt-0.5">
                    Directory page detected — each dealer extracted individually
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <ExportButtons leads={successLeads} />
                <div className="flex rounded-lg overflow-hidden border border-slate-700 shrink-0">
                  {['cards','table'].map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`px-3 py-1.5 text-xs capitalize transition-colors ${view === v ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {view === 'cards'
              ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{leads.map((l, i) => <LeadCard key={i} lead={l} index={i} />)}</div>
              : <TableView leads={successLeads} />
            }
          </>
        )}
      </main>
    </div>
  );
}
