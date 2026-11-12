import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @nullpoint/core ships TypeScript source.
  transpilePackages: ["@nullpoint/core"],
};

export default createMDX()(nextConfig);
