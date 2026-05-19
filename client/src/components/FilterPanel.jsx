import { useState } from 'react';

export default function FilterPanel({ filters, onScrapeStates }) {
  const isDropdown = filters?.type === 'dropdown';
  const stateItems = isDropdown ? (filters?.stateOptions || []) : (filters?.stateLinks || []);

  const getKey   = item => isDropdown ? item.value : item.href;
  const getLabel = item => item.label;

  const [selected, setSelected]   = useState(new Set());
  const [deepScrape, setDeepScrape] = useState(false);

  const toggle    = key => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allSel    = stateItems.length > 0 && selected.size === stateItems.length;
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(stateItems.map(getKey)));

  const handleScrape = () => {
    const items = selected.size > 0
      ? stateItems.filter(item => selected.has(getKey(item)))
      : stateItems;
    onScrapeStates(items, filters, deepScrape);
  };

  if (!stateItems.length) return null;
  const count = selected.size || stateItems.length;

  return (
    <div className="card border-cyan-900/50 bg-cyan-950/20 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-cyan-300 flex items-center gap-2">
            State-wise Data Detected
            <span className="badge bg-cyan-900 text-cyan-300 border border-cyan-700 text-xs">
              {stateItems.length} states
            </span>
            {isDropdown && (
              <span className="badge bg-slate-800 text-slate-400 border border-slate-700 text-xs">dropdown</span>
            )}
          </h3>
          <p className="text-slate-400 text-xs mt-1">
            Select states and click <strong className="text-white">Scrape</strong> — results stream in as each state finishes.
          </p>
        </div>
      </div>

      {/* Select all */}
      <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 w-fit">
        <input type="checkbox" checked={allSel} onChange={toggleAll} className="w-4 h-4 accent-cyan-500" />
        {allSel ? 'Deselect all' : 'Select all states'}
        <span className="text-slate-500 text-xs">({selected.size} / {stateItems.length})</span>
      </label>

      {/* State pills */}
      <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1">
        {stateItems.map((item, i) => {
          const key = getKey(item); const on = selected.has(key);
          return (
            <button key={i} onClick={() => toggle(key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                on ? 'bg-cyan-600 border-cyan-500 text-white'
                   : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-600 hover:text-white'
              }`}>
              {getLabel(item)}
            </button>
          );
        })}
      </div>

      {/* Deep Scan toggle + Scrape button */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={handleScrape} className="btn-primary text-sm">
          Scrape {count} State{count !== 1 ? 's' : ''}
        </button>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setDeepScrape(p => !p)}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${deepScrape ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${deepScrape ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm text-slate-300">Deep Scan</span>
          <span className="text-slate-500 text-xs">(visits each dealer's own website for extra data)</span>
        </label>
      </div>
    </div>
  );
}
