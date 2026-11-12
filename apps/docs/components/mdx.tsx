import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";
import { LiveChecks, MainnetProof } from "@/components/live";
import { Mermaid } from "@/components/mdx/mermaid";

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Mermaid, Steps, Step, Tabs, Tab, LiveChecks, MainnetProof, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
