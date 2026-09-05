import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root to this folder — without it, Next.js/Turbopack
  // walks up the directory tree looking for lockfiles and can pick up an
  // unrelated one higher up (e.g. a stray package-lock.json in the user's
  // home directory on Windows), which just produces a harmless but
  // confusing "ignored package-lock.json" warning on every `npm run dev`.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
