import { defineDocs } from "fumadocs-mdx/macro";
import { loader } from "fumadocs-core/source";

const docs = defineDocs({ dir: "content/docs" });

// docs.nullpoint.fun serves the docs at the root.
export const source = loader({ baseUrl: "/", source: docs.toFumadocsSource() });
