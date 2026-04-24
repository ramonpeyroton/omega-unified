import logoImg from '../assets/logo.png';

// Shared shell used by both the Privacy Policy and Terms & Conditions
// public pages. Matches the Omega Cloud / Orange palette from the rest
// of the app so a carrier reviewer sees a real, branded business page.
export default function LegalPage({ title, subtitle, children, updated }) {
  return (
    <div className="min-h-screen bg-omega-cloud text-omega-charcoal">
      <header className="bg-omega-charcoal text-white">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center gap-4">
          <img src={logoImg} alt="Omega Development" className="h-10 w-auto" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.25em] text-white/60 font-semibold">Omega Development LLC</p>
            <h1 className="text-xl sm:text-2xl font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-white/70 text-sm mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 sm:py-10">
        <article className="prose prose-sm sm:prose max-w-none">
          {children}
        </article>

        {updated && (
          <p className="mt-10 text-xs text-omega-stone border-t border-gray-200 pt-4">
            Last updated: <strong>{updated}</strong>
          </p>
        )}
      </main>

      <footer className="bg-omega-charcoal text-white/60 text-xs">
        <div className="max-w-3xl mx-auto px-6 py-5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-white/80">Omega Development LLC</span>
          <span>Fairfield County, Connecticut</span>
          <a className="hover:text-white underline" href="/privacy">Privacy Policy</a>
          <a className="hover:text-white underline" href="/terms">Terms &amp; Conditions</a>
        </div>
      </footer>
    </div>
  );
}

// Tiny utility — simple h2/p classes so we don't depend on a Markdown
// library. Used inside both pages to keep the typography consistent.
export function H2({ children }) {
  return <h2 className="text-lg sm:text-xl font-bold text-omega-charcoal mt-6 mb-2">{children}</h2>;
}
export function P({ children }) {
  return <p className="text-sm sm:text-[15px] leading-relaxed text-omega-slate mb-3">{children}</p>;
}
export function UL({ children }) {
  return <ul className="list-disc pl-6 space-y-1 text-sm sm:text-[15px] text-omega-slate mb-3">{children}</ul>;
}
