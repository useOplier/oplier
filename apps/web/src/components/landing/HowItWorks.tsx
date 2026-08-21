const steps = [
  {
    n: "01",
    title: "Tell Oplier",
    body: "Describe what you want in natural language.",
  },
  {
    n: "02",
    title: "Oplier structures it",
    body: "Your request becomes a clear transaction or UPM.",
  },
  {
    n: "03",
    title: "Oplier executes",
    body: "The platform carries out the defined action and manages the resulting position.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-slate-line bg-paper py-20 sm:py-28">
      <div className="shell">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          From conversation to execution.
        </h2>

        <div className="relative mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-6">
          {/* Connecting line — this genuinely is a sequence, so the numbering earns its place. */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-5 hidden h-px bg-slate-line sm:block"
          />
          {steps.map((step) => (
            <div key={step.n} className="relative flex flex-col items-center text-center sm:items-start sm:text-left">
              <span className="num relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-line bg-paper text-xs font-medium text-slate">
                {step.n}
              </span>
              <h3 className="mt-4 text-base font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-slate">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
