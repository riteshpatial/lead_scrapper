import { useState } from 'react';

function CopyCell({ text }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <span className="text-slate-600">—</span>;
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).catch(()=>{}); setCopied(true); setTimeout(()=>setCopied(false),1200); }}
      className="text-left text-slate-300 hover:text-white group flex items-center gap-1">
      <span className="truncate max-w-[180px]">{text}</span>
      <span className={`shrink-0 text-xs ${copied ? 'text-emerald-400' : 'text-slate-600 group-hover:text-slate-400'}`}>{copied ? '✓' : '⎘'}</span>
    </button>
  );
}

const TH = ({ children }) => (
  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{children}</th>
);
const TD = ({ children, className = '' }) => (
  <td className={`px-3 py-2.5 text-xs text-slate-300 align-top ${className}`}>{children}</td>
);

export default function TableView({ leads }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full">
        <thead className="bg-slate-800/80">
          <tr>
            <TH>#</TH>
            <TH>State</TH>
            <TH>Dealer Name</TH>
            <TH>Company</TH>
            <TH>City</TH>
            <TH>Locality</TH>
            <TH>PIN</TH>
            <TH>Address</TH>
            <TH>Phone</TH>
            <TH>Email</TH>
            <TH>Rating</TH>
            <TH>Status</TH>
            <TH>Website</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {leads.map((l, i) => {
            const open = (l.status || '').toLowerCase().includes('open');
            return (
              <tr key={i} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                <TD className="text-slate-600">{i + 1}</TD>
                <TD>{l.state || '—'}</TD>
                <TD><span className="font-medium text-white">{l.dealerName || '—'}</span></TD>
                <TD className="text-slate-400 max-w-[140px]"><span className="line-clamp-2">{l.companyName || '—'}</span></TD>
                <TD>{l.city || '—'}</TD>
                <TD>{l.locality || '—'}</TD>
                <TD className="font-mono">{l.pinCode || '—'}</TD>
                <TD className="max-w-[180px]"><span className="line-clamp-2 text-slate-400">{l.address || '—'}</span></TD>
                <TD><CopyCell text={l.phone || l.phones?.[0]} /></TD>
                <TD><CopyCell text={l.email || l.emails?.[0]} /></TD>
                <TD>{l.rating ? <span className="text-yellow-400">⭐ {l.rating.toFixed(1)}</span> : '—'}</TD>
                <TD>
                  {l.status
                    ? <span className={`badge text-xs border ${open ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-red-950 text-red-400 border-red-800'}`}>{l.status}</span>
                    : '—'}
                </TD>
                <TD>
                  {l.website
                    ? <a href={l.website} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline truncate block max-w-[140px]">{l.website.replace(/^https?:\/\/(www\.)?/,'')}</a>
                    : '—'}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
