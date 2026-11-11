// Glossary popover (COPY.md §G): dotted underline, definition on hover, focus or tap.
const GLOSSARY = {
  share: "Your slice of the vault. The number of shares you hold stays the same; what each one is worth goes up.",
  "share price": "Everything the vault owns, minus what it owes, divided by all shares. The contract works it out itself from signed prices.",
  funding: "An hourly payment between traders on Hyperliquid. When more people bet on prices rising, they pay the people betting on prices falling.",
  short: "A position that gains when the price falls.",
  hedge: "Holding a coin and an equal short, so price moves cancel.",
  agent: "The bot that runs the vault every minute, with an AI model that picks the coin. It can place trades. It can't move money out.",
  "MPC signature": "A signature made by NEAR's network of signers on the contract's behalf. No single person ever holds the key.",
  enclave: "A sealed part of a chip. Nobody can see or change the code running inside, and it can prove what it ran.",
} as const;

export function Term({ k, children }: { k: keyof typeof GLOSSARY; children?: React.ReactNode }) {
  return (
    <span className="group relative inline-block">
      <span tabIndex={0} className="term" aria-describedby={`term-${k.replace(" ", "-")}`}>
        {children ?? k}
      </span>
      <span
        id={`term-${k.replace(" ", "-")}`}
        role="tooltip"
        className="panel pointer-events-none invisible absolute left-0 top-full z-20 mt-2 w-[280px] p-3 text-[13px] font-normal leading-[1.45] tracking-normal normal-case opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {GLOSSARY[k]}
      </span>
    </span>
  );
}
