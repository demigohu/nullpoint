"use client";
// Mermaid, drawn in the two DESIGN.md colors read from the page (--t sign, --f ground). Renders in the
// browser; the chart source stays in the MDX, so it reads as text in the repo too.
import { useEffect, useId, useState } from "react";

export function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    render(id, chart).then((s) => live && setSvg(s), () => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [id, chart]);
  return (
    <figure className="diagram not-prose" aria-label={title}>
      {/* The source shows until the drawing is ready, and stays if it can't be drawn. */}
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <pre className="font-mono text-[12px]">{chart}</pre>}
      {title && <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em]">{title}</figcaption>}
    </figure>
  );
}

async function render(id: string, chart: string) {
  const { default: mermaid } = await import("mermaid");
  const css = getComputedStyle(document.documentElement);
  const t = css.getPropertyValue("--t").trim() || "#ff5b14";
  const f = css.getPropertyValue("--f").trim() || "#0a0a0a";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    fontFamily: "var(--font-jb), ui-monospace, monospace",
    theme: "base",
    // DESIGN.md: no shadows, flat two-color surfaces.
    themeCSS: "* { filter: none !important; }",
    themeVariables: {
      darkMode: true,
      background: f,
      primaryColor: f,
      primaryTextColor: t,
      primaryBorderColor: t,
      secondaryColor: f,
      secondaryTextColor: t,
      secondaryBorderColor: t,
      tertiaryColor: f,
      tertiaryTextColor: t,
      tertiaryBorderColor: t,
      lineColor: t,
      textColor: t,
      mainBkg: f,
      nodeBorder: t,
      clusterBkg: f,
      clusterBorder: t,
      edgeLabelBackground: f,
      actorBkg: f,
      actorBorder: t,
      actorTextColor: t,
      actorLineColor: t,
      signalColor: t,
      signalTextColor: t,
      labelBoxBkgColor: f,
      labelBoxBorderColor: t,
      labelTextColor: t,
      loopTextColor: t,
      noteBkgColor: t,
      noteTextColor: f,
      noteBorderColor: t,
      activationBkgColor: t,
      activationBorderColor: t,
      sequenceNumberColor: f,
      fontSize: "14px",
    },
  });
  return (await mermaid.render(id, chart)).svg;
}
