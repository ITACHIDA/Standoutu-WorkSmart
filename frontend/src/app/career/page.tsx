'use client';
import TopNav from "../../components/TopNav";

type RoleCard = {
  title: string;
  location: string;
  blurb: string;
};

const roles: RoleCard[] = [
  {
    title: "Senior Fullstack Engineer",
    location: "Remote",
    blurb: "Ship features across Electron, Next.js, and Fastify. Own DX and reliability.",
  },
  {
    title: "Product Manager, Automations",
    location: "Remote · North America",
    blurb: "Shape the autofill roadmap and collaborate with bidders, managers, and admins.",
  },
  {
    title: "QA Engineer",
    location: "Hybrid · Toronto",
    blurb: "Break our flows before users do. Playwright and exploratory testing welcome.",
  },
];

export default function CareerPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <TopNav />
      <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
        <section className="space-y-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
            Careers
          </p>
          <h1 className="text-3xl font-semibold">Join the SmartWork crew</h1>
          <p className="text-sm text-slate-600">
            We are building a calmer, role-aware toolkit for sourcing teams. Explore open roles below.
          </p>
        </section>

        <div className="space-y-3">
          {roles.map((role) => (
            <div
              key={role.title}
              className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-2 shadow-[0_12px_40px_-30px_rgba(0,0,0,0.25)]"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-lg font-semibold">{role.title}</p>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {role.location}
                </span>
              </div>
              <p className="text-sm text-slate-600">{role.blurb}</p>
              <div className="flex gap-3 text-sm">
                <button className="rounded-full bg-[#4ade80] px-4 py-2 font-semibold text-[#0b1224] hover:brightness-110">
                  Apply
                </button>
                <button className="rounded-full border border-slate-200 px-4 py-2 text-slate-800 hover:bg-slate-50">
                  Save role
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
