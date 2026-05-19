import { useState } from 'react';

function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} title={`Copy: ${text}`}
      className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:text-white transition-colors group max-w-xs">
      <span className="truncate">{label || text}</span>
      <span className={`shrink-0 ml-1 ${copied ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
        {copied ? '✓' : '⎘'}
      </span>
    </button>
  );
}

function StatusBadge({ status }) {
  if (!status) return null;
  const open = status.toLowerCase().includes('open');
  return (
    <span className={`badge text-xs border ${open ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-red-950 text-red-400 border-red-800'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {status}
    </span>
  );
}

function Stars({ rating }) {
  if (!rating) return null;
  const full = Math.round(rating);
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-400">
      {'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}
      <span className="text-slate-400 ml-0.5">{rating.toFixed(1)}</span>
    </span>
  );
}

export default function LeadCard({ lead, index }) {
  if (lead._status === 'error') {
    return (
      <div className="card border-red-900/40">
        <p className="text-red-400 text-sm font-medium">Failed: {lead.sourceUrl}</p>
        <p className="text-slate-500 text-xs mt-1">{lead.error}</p>
      </div>
    );
  }

  return (
    <div className="card hover:border-slate-700 transition-colors flex flex-col gap-3">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-white text-sm leading-snug">{lead.dealerName || 'Unknown'}</h3>
            <StatusBadge status={lead.status} />
          </div>
          {lead.companyName && lead.companyName !== lead.dealerName && (
            <p className="text-slate-400 text-xs mt-0.5 truncate">{lead.companyName}</p>
          )}
        </div>
        <span className="badge bg-cyan-950 text-cyan-400 border border-cyan-800 shrink-0 text-xs">#{index + 1}</span>
      </div>

      {/* ── Rating + Services ── */}
      {(lead.rating || lead.services?.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <Stars rating={lead.rating} />
          {lead.services?.map((s, i) => (
            <span key={i} className="badge bg-slate-800 text-slate-300 border border-slate-700 text-xs">{s}</span>
          ))}
        </div>
      )}

      {/* ── Contact ── */}
      <div className="space-y-1.5">
        {lead.emails?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-emerald-500 w-12 shrink-0 pt-1">Email</span>
            <div className="flex flex-wrap gap-1.5">
              {lead.emails.map((e, i) => <CopyBtn key={i} text={e} />)}
            </div>
          </div>
        )}
        {lead.phones?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-start">
            <span className="text-xs text-yellow-500 w-12 shrink-0 pt-1">Phone</span>
            <div className="flex flex-wrap gap-1.5">
              {lead.phones.map((p, i) => <CopyBtn key={i} text={p} />)}
            </div>
          </div>
        )}
      </div>

      {/* ── Location ── */}
      {(lead.address || lead.city || lead.state) && (
        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-xs space-y-0.5">
          {lead.address && <p className="text-slate-300 leading-snug">{lead.address}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500 mt-1">
            {lead.locality  && <span><span className="text-slate-600">Area: </span>{lead.locality}</span>}
            {lead.city      && <span><span className="text-slate-600">City: </span>{lead.city}</span>}
            {lead.state     && <span><span className="text-slate-600">State: </span>{lead.state}</span>}
            {lead.pinCode   && <span><span className="text-slate-600">PIN: </span>{lead.pinCode}</span>}
          </div>
        </div>
      )}

      {/* ── Website ── */}
      {lead.website && lead.website !== lead.sourceUrl && (
        <a href={lead.website} target="_blank" rel="noreferrer"
          className="text-cyan-400 hover:text-cyan-300 text-xs hover:underline truncate block">
          🌐 {lead.website}
        </a>
      )}

      {/* Empty state */}
      {!lead.emails?.length && !lead.phones?.length && (
        <p className="text-slate-600 text-xs italic">No contact info found for this listing.</p>
      )}
    </div>
  );
}
