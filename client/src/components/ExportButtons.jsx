import { useState } from 'react';

function buildCSV(leads) {
  const H = ['#','State','Dealer Name','Company','City','Locality','PIN Code','Address','Phone','All Phones','Email','All Emails','Rating','Status','Services','Website','Source URL','Scraped At'];
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const rows = leads.map((l, i) => [
    esc(i + 1),
    esc(l.state),
    esc(l.dealerName),
    esc(l.companyName),
    esc(l.city),
    esc(l.locality),
    esc(l.pinCode),
    esc(l.address),
    esc(l.phone || l.phones?.[0]),
    esc((l.phones || []).join('; ')),
    esc(l.email || l.emails?.[0]),
    esc((l.emails || []).join('; ')),
    esc(l.rating != null ? l.rating : ''),
    esc(l.status),
    esc((l.services || []).join('; ')),
    esc(l.website),
    esc(l.sourceUrl),
    esc(l.scrapedAt),
  ]);
  return [H.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function download(content, name, type) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type })),
    download: name,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

export default function ExportButtons({ leads }) {
  const [copiedE, setCopiedE] = useState(false);
  const [copiedP, setCopiedP] = useState(false);

  const allEmails = [...new Set(leads.flatMap(l => l.emails || []))];
  const allPhones = [...new Set(leads.flatMap(l => l.phones || []))];

  const copyAll = (arr, set) => {
    navigator.clipboard.writeText(arr.join('\n')).catch(() => {});
    set(true); setTimeout(() => set(false), 2000);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => download(buildCSV(leads), `leads_${Date.now()}.csv`, 'text/csv')} className="btn-primary text-sm py-2">
        Export CSV
      </button>
      <button onClick={() => download(JSON.stringify(leads, null, 2), `leads_${Date.now()}.json`, 'application/json')} className="btn-secondary text-sm">
        Export JSON
      </button>
      <button onClick={() => copyAll(allEmails, setCopiedE)} className="btn-secondary text-sm">
        {copiedE ? `✓ Copied ${allEmails.length}` : `Copy Emails (${allEmails.length})`}
      </button>
      <button onClick={() => copyAll(allPhones, setCopiedP)} className="btn-secondary text-sm">
        {copiedP ? `✓ Copied ${allPhones.length}` : `Copy Phones (${allPhones.length})`}
      </button>
    </div>
  );
}
