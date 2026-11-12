import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/components/mdx";
import { source } from "@/lib/source";

// The Verify pages read the chain; everything else is static. A minute of caching keeps both honest.
export const revalidate = 60;

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const page = source.getPage((await props.params).slug);
  if (!page) notFound();
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle className="wdth-118 text-[clamp(2rem,4vw,3.6rem)] font-extrabold leading-[0.95] tracking-[-0.045em]">{page.data.title}</DocsTitle>
      <DocsDescription className="text-[clamp(16px,1.2vw,19px)] leading-[1.5]">{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const page = source.getPage((await props.params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
