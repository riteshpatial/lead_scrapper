import { useState } from 'react';

export default function FilterPanel({ filters, onScrapeStates, analyzing }) {
  const isDropdown = filters?.type === 'dropdown';
  const stateItems = isDropdown
    ? (filters?.stateOptions || [])
    : (filters?.stateLinks   || []);

  const getKey   = item => isDropdown ? item.value : item.href;
  const getLabel = item => item.label;

  const [selected, setSelected] = useState(new Set());

  const toggle = key =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allSelected = stateItems.length > 0 && selected.size === stateItems.length;
  const toggleAll   = () =>
    setSelected(allSelected ? new Set() : new Set(stateItems.map(getKey)));

  const handleScrape = () => {
    const items = selected.size > 0
      ? stateItems.filter(item => selected.has(getKey(item)))
      : stateItems;
    onScrapeStates(items, filters);
  };

  if (!stateItems.length) return null;

  const count = selected.size || stateItems.length;

  return (
    <div className="card border-indigo-900/50 bg-indigo-950/20 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-indigo-300 flex items-center gap-2">
            State-wise Data Detected
            <span className="badge bg-indigo-900 text-indigo-300 border border-indigo-700 text-xs">
              {stateItems.length} states
            </span>
            {isDropdown && (
              <span className="badge bg-slate-800 text-slate-400 border border-slate-700 text-xs">
                dropdown filter
              </span>
            )}
          </h3>
          <p className="text-slate-400 text-xs mt-1">
            Select states below, then click <strong className="text-white">Scrape</strong> — results stream in as each state finishes.
          </p>
        </div>
        {analyzing && <span className="text-slate-500 text-xs animate-pulse shrink-0">Analyzing…</span>}
      </div>

      {/* Select all */}
      <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 w-fit">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-indigo-500" />
        {allSelected ? 'Deselect all' : 'Select all states'}
        <span className="text-slate-500 text-xs">({selected.size} / {stateItems.length} selected)</span>
      </label>

      {/* State pills */}
      <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1">
        {stateItems.map((item, i) => {
          const key = getKey(item);
          const on  = selected.has(key);
          return (
            <button key={i} onClick={() => toggle(key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                on
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-600 hover:text-white'
              }`}>
              {getLabel(item)}
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
