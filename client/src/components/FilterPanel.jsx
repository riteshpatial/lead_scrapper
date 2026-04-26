import { useState } from 'react';

export default function FilterPanel({ filters, onScrapeStates, analyzing }) {
  const stateLinks = filters?.stateLinks || [];
  const [selected, setSelected] = useState(new Set());

  const toggle = (href) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(href) ? next.delete(href) : next.add(href);
      return next;
    });

  const allSelected = stateLinks.length > 0 && selected.size === stateLinks.length;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(stateLinks.map(l => l.href)));

  const handleScrape = () => {
    const links = selected.size > 0
      ? stateLinks.filter(l => selected.has(l.href))
      : stateLinks;
    onScrapeStates(links);
  };

  if (!stateLinks.length) return null;

  const count = selected.size || stateLinks.length;

  return (
    <div className="card border-indigo-900/50 bg-indigo-950/20 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-indigo-300 flex items-center gap-2">
            State-wise Data Detected
            <span className="badge bg-indigo-900 text-indigo-300 border border-indigo-700 text-xs">{stateLinks.length} states</span>
          </h3>
          <p className="text-slate-400 text-xs mt-1">
            Select states below, then click <strong className="text-white">Scrape</strong> — results will appear in real time as each state finishes.
          </p>
        </div>
        {analyzing && <span className="text-slate-500 text-xs animate-pulse shrink-0">Analyzing…</span>}
      </div>

      {/* Select all */}
      <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 w-fit">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-indigo-500" />
        {allSelected ? 'Deselect all' : 'Select all states'}
        <span className="text-slate-500 text-xs">({selected.size} / {stateLinks.length} selected)</span>
      </label>

      {/* State pills */}
      <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1">
        {stateLinks.map((link, i) => {
          const on = selected.has(link.href);
          return (
            <button key={i} onClick={() => toggle(link.href)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                on ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-600 hover:text-white'
              }`}>
              {link.label}
            </button>
          );
        })}
      </div>

      <button onClick={handleScrape} className="btn-primary text-sm w-fit">
        Scrape {count} State{count !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
