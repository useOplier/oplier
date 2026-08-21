import { MessageCircle, ArrowLeftRight, Settings2, LineChart } from "lucide-react";

const capabilities = [
  {
    icon: MessageCircle,
    title: "Ask",
    body: "Use natural language to understand assets, positions, markets, and upcoming events.",
  },
  {
    icon: ArrowLeftRight,
    title: "Trade",
    body: "Request RWA transactions without manually constructing the transaction flow.",
  },
  {
    icon: Settings2,
    title: "Manage",
    body: "Create UPMs that manage positions automatically based on conditions you define.",
  },
  {
    icon: LineChart,
    title: "Understand",
    body: "Get AI-driven insights and fundamental analysis before making decisions.",
  },
];

export function Capabilities() {
  return (
    <section className="border-b border-slate-line bg-white/50 py-20 sm:py-28">
      <div className="shell">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          What Oplier does.
        </h2>
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-line bg-slate-line sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-paper p-7">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-tint">
                <Icon className="h-5 w-5 text-accent-dim" />
              </span>
              <h3 className="mt-5 text-base font-semibold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
