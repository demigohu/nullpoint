/** A docs page: title, one-paragraph summary, then prose. */
export function Doc({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <article>
      <h1 className="wdth-118 max-w-[22ch] text-[clamp(2.2rem,4.4vw,4.4rem)] font-extrabold leading-[0.92] tracking-[-0.045em]">{title}</h1>
      <p className="mt-5 max-w-[60ch] text-[clamp(17px,1.3vw,20px)] leading-[1.5]">{lede}</p>
      <div className="prose mt-10 border-t border-tc pt-2">{children}</div>
    </article>
  );
}
