export default function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            LS
          </div>
          <div>
            <h1 className="font-bold text-white text-lg leading-none">LeadScraper Pro</h1>
            <p className="text-slate-500 text-xs">Digital Marketing Lead Extractor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-emerald-950 text-emerald-400 border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}
