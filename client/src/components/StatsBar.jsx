const Stat = ({ label, value, color }) => (
  <div className="flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-xl px-5 py-3.5 min-w-[90px]">
    <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
    <span className="text-slate-500 text-xs mt-0.5">{label}</span>
  </div>
);

export default function StatsBar({ leadsCount, emailsCount, phonesCount, scrapeTime, isListingPage }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Stat label={isListingPage ? 'Dealers' : 'Leads'}  value={leadsCount}   color="text-indigo-400" />
      <Stat label="Emails"                                value={emailsCount}  color="text-emerald-400" />
      <Stat label="Phones"                                value={phonesCount}  color="text-yellow-400" />
      {scrapeTime && <Stat label="Seconds"                value={scrapeTime}   color="text-slate-300" />}
    </div>
  );
}
