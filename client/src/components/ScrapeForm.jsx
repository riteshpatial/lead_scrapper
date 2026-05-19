import { useState } from 'react';

export default function ScrapeForm({ onScrape, loading }) {
  const [mode, setMode] = useState('single'); // 'single' | 'batch'
  const [singleUrl, setSingleUrl] = useState('');
  const [batchUrls, setBatchUrls] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'single') {
      const url = singleUrl.trim();
      if (!url) return;
      onScrape([url]);
    } else {
      const urls = batchUrls
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean);
      if (!urls.length) return;
      onScrape(urls);
    }
  };

  return (
    <div className="card">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white mb-1">Extract Business Leads</h2>
        <p className="text-slate-400 text-sm">
          Enter any business website URL to extract emails, phone numbers, social profiles, addresses and more.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'single' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Single URL
        </button>
        <button
          type="button"
          onClick={() => setMode('batch')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'batch' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Batch (up to 10 URLs)
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'single' ? (
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Target Website URL</label>
            <input
              type="text"
              value={singleUrl}
              onChange={(e) => setSingleUrl(e.target.value)}
              placeholder="https://example.com  or  example.com"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              disabled={loading}
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Website URLs — one per line (max 10)
            </label>
            <textarea
              value={batchUrls}
              onChange={(e) => setBatchUrls(e.target.value)}
              placeholder={`https://business1.com\nhttps://business2.com\nhttps://business3.com`}
              rows={6}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono text-sm resize-none"
              disabled={loading}
            />
            <p className="text-slate-500 text-xs mt-1">
              {batchUrls.split('\n').filter((l) => l.trim()).length} URL(s) entered
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Scraping...
              </>
            ) : (
              'Scrape Leads'
            )}
          </button>
          <p className="text-slate-500 text-xs">
            Automatically crawls contact &amp; about pages for maximum data extraction
          </p>
        </div>
      </form>
    </div>
  );
}
