const faqs = [
  {
    q: "What is a UPM?",
    a: "A UPM (Unmanned Position Manager) is a rule you define once, like buying $10 of AAPLx every time it drops 5%, that Oplier then carries out automatically for you.",
  },
  {
    q: "Does Oplier execute transactions without my approval?",
    a: "A UPM only acts within the limits and permissions you set when you activate it. Any one-off transaction Oplier prepares is never sent until you personally approve it and sign with your wallet.",
  },
  {
    q: "Can I pause or stop a UPM at any time?",
    a: "Yes. You can pause, resume, or delete any UPM from the Systems screen whenever you want.",
  },
  {
    q: "Does Oplier ever take custody of my funds?",
    a: "No. Oplier requests scoped, revocable permissions to act on your behalf. Your wallet stays in your control at all times.",
  },
  {
    q: "What assets can I manage with Oplier?",
    a: "Real-world assets available in the current supported asset registry, including AAPLx, METAx, NVDAx, and GLDx, quoted and settled in USDG.",
  },
];

export function ClosingCta() {
  return (
    <section className="bg-ink py-24 sm:py-32">
      <div className="shell flex flex-col items-center text-center">
        <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-paper sm:text-4xl">
          Put your real-world assets to work.
        </h2>
        <p className="mt-4 max-w-md text-base text-paper/70">
          Manage, understand, and execute your RWA positions with Oplier.
        </p>

        <div className="mt-16 w-full max-w-2xl text-left">
          <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-paper/50">
            Frequently asked questions
          </h3>
          <div className="mt-6 divide-y divide-paper/10 border-t border-paper/10">
            {faqs.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-paper">
                  {item.q}
                  <span className="shrink-0 text-paper/40 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-paper/70">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
