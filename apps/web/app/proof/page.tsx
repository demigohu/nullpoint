import { redirect } from "next/navigation";
import { DOCS_URL } from "@/lib/config";

// The live checks moved to the docs (apps/docs, /verify).
export default function Proof() {
  redirect(`${DOCS_URL}/verify`);
}
