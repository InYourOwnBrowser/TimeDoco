export const Logo = ({ className = "h-12" }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 300 80"
    className={className}
  >
    {/* Row 1: Top of the "T" and the folded document corner */}
    <rect x="10" y="10" width="18" height="18" rx="2" className="fill-ink dark:fill-stone" />
    <rect x="32" y="10" width="18" height="18" rx="2" className="fill-ink dark:fill-stone" />

    {/* Rust Document Square with Dog-Eared Fold */}
    <polygon points="54,10 66,10 72,16 72,28 54,28" className="fill-rust" />
    <polygon points="66,10 72,16 66,16" className="fill-[#8F452E]" />

    {/* Row 2: Adaptive stone cell paired with adaptive ink blocks */}
    <rect x="10" y="32" width="18" height="18" rx="2" className="fill-stone dark:fill-graphite" />
    <rect x="32" y="32" width="18" height="18" rx="2" className="fill-ink dark:fill-stone" />
    <rect x="54" y="32" width="18" height="18" rx="2" className="fill-ink dark:fill-stone" />

    {/* Row 3: Adaptive stone cells balancing the grid structure */}
    <rect x="10" y="54" width="18" height="18" rx="2" className="fill-stone dark:fill-graphite" />
    <rect x="32" y="54" width="18" height="18" rx="2" className="fill-ink dark:fill-stone" />
    <rect x="54" y="54" width="18" height="18" rx="2" className="fill-stone dark:fill-graphite" />

    {/* Two-tone Brand Name (Adaptive Time text, Rust Doco) */}
    <text x="88" y="54" className="font-sans text-[38px] font-bold tracking-[-0.5px]">
      <tspan className="fill-ink dark:fill-stone">Time</tspan>
      <tspan className="fill-rust">Doco</tspan>
    </text>
  </svg>
);
