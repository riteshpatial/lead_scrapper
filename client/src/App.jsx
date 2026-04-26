import { useState } from 'react';
import axios from 'axios';
import Header       from './components/Header';
import ScrapeForm   from './components/ScrapeForm';
import FilterPanel  from './components/FilterPanel';
import StatsBar     from './components/StatsBar';
import LeadCard     from './components/LeadCard';
import ExportButtons from './components/ExportButtons';
import TableView    from './components/TableView';

export default function App() {
  const [leads, setLeads]                     = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [streamActive, setStreamActive]       = useState(false);
  const [error, setError]                     = useState('');
  const [scrapeTime, setScrapeTime]           = useState(null);
  const [view, setView]                       = useState('cards');
  const [detectedFilters, setDetectedFilters] = useState(null);
  const [lastUrl, setLastUrl]                 = useState('');
  const [progress, setProgress]               = useState('');
  const [progressDetail, setProgressDetail]   = useState('');

  // ── Scrape one or more URLs ──────────────────────────────────────────────
  const handleScrape = async (urls) => {
    setLoading(true);
    setError('');
    setLeads([]);
    setDetectedFilters(null);
    setProgress('Scraping…');
    setProgressDetail('');
    setLastUrl(urls[0] || '');
    const t0 = Date.now();
    try {
      const { data } = await axios.post('/api/scrape', { urls });
      setLeads(data.results || []);
      setScrapeTime(((Date.now() - t0) / 1000).toFixed(1));
      setProgress('');

      // Filters returned directly with the scrape response (filter-form pages)
      if (data.filters) {
        setDetectedFilters(data.filters);
      } else if (urls.length === 1 && (!data.results || data.results.length <= 1)) {
        // Fallback: background filter detection when we got very few results
        detectFilters(urls[0]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Scraping failed. Is the server running on port 5000?');
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  // Background filter detection (only used as a fallback)
  const detectFilters = async (url) => {
    try {
      const { data } = await axios.post('/api/analyze', { url });
      if (data.filters) setDetectedFilters(data.filters);
    } catch (_) {}
  };

  // ── SSE streaming: scrape states one-by-one, push leads in real-time ────
  const handleScrapeStates = async (items, filtersCtx) => {
    setStreamActive(true);
    setError('');
    setLeads([]);
    setProgress(`Starting — 0 / ${items.length} states`);
    setProgressDetail('');
    const t0  = Date.now();
    const acc = [];
    let done  = 0;

    const isDropdown = filtersCtx?.type === 'dropdown';
    const body = isDropdown
      ? {
          type:            'dropdown',
          url:             lastUrl,
          stateSelector:    filtersCtx.stateSelector,
          stateSelectorCSS: filtersCtx.stateSelectorCSS,
          searchSelector:   filtersCtx.searchSelector,
          stateOptions:     items,
        }
      : { stateLinks: items };

    try {
      const res = await fetch('/api/scrape-states-stream', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();

        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6));

            if (ev.type === 'start') {
              setProgress(`[${ev.index}/${ev.total}] ${ev.state}`);
              setProgressDetail('Starting…');
            } else if (ev.type === 'progress') {
              setProgressDetail(ev.msg);
            } else if (ev.type === 'result') {
              done++;
              acc.push(...ev.leads);
              setLeads([...acc]);
              setProgress(`[${done}/${items.length}] ${ev.state}: ${ev.count} dealers — Total: ${ev.totalSoFar}`);
              setProgressDetail('');
            } else if (ev.type === 'error') {
              done++;
              setProgress(`[${done}/${items.length}] ${ev.state}: failed`);
              setProgressDetail(ev.error);
            } else if (ev.type === 'done') {
              setScrapeTime(((Date.now() - t0) / 1000).toFixed(0));
              setProgress('');
              setProgressDetail('');
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
      setProgressDetail('');
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

        {error && (
          <div className="p-4 bg-red-950 border border-red-700 rounded-xl text-red-300 text-sm">{error}</div>
        )}

        {/* Spinner + live progress */}
        {busy && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            {progress && (
              <p className="text-slate-300 text-sm font-medium text-center max-w-lg">{progress}</p>
            )}
            {progressDetail && (
              <p className="text-slate-500 text-xs text-center max-w-lg animate-pulse">{progressDetail}</p>
            )}
            {!progress && !progressDetail && (
              <p className="text-slate-400 text-sm">Scraping and extracting leads…</p>
            )}
            {streamActive && leads.length > 0 && (
              <p className="text-indigo-400 text-xs">{leads.length} leads collected so far</p>
            )}
          </div>
        )}

        {/* Filter panel — shown when a search-form page is detected */}
        {!busy && detectedFilters && (
          <FilterPanel
            filters={detectedFilters}
            onScrapeStates={handleScrapeStates}
            analyzing={false}
          />
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
                    Directory page — each dealer extracted individually
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

        {/* Prompt user to scrape state-wise when filter form detected but no leads yet */}
        {!busy && detectedFilters && leads.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            Select states above and click <span className="text-white font-medium">Scrape</span> to extract dealer leads.
          </div>
        )}
      </main>
    </div>
  );
}
