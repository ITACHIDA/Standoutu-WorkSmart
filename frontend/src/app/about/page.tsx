'use client';
import TopNav from "../../components/TopNav";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <TopNav />
      <div className="mx-auto max-w-4xl px-4 py-12 space-y-10">
        <section className="space-y-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
            Our story
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">Building a calmer bidder workflow</h1>
          <p className="text-sm text-slate-600">
            SmartWork keeps profiles, resumes, sessions, and autofill flows in one place so teams can move faster and stay compliant.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Role-aware access",
              text: "Admins govern users and roles, managers orchestrate bidders, and observers stay read-only until promoted.",
            },
            {
              title: "Guided autofill",
              text: "Playwright-powered sessions stream to Electron so your bidders can see and fill forms without juggling tabs.",
            },
            {
              title: "LLM-ready",
              text: "Configurable LLM settings to run analyses and recommendations while keeping secrets out of code.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_40px_-30px_rgba(0,0,0,0.25)]"
            >
              <p className="text-sm font-semibold text-slate-900">{card.title}</p>
              <p className="mt-2 text-sm text-slate-600">{card.text}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
