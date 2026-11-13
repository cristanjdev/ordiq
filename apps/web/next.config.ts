import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@ordiq/contracts"],
  // Loaded from node_modules at runtime instead of bundled; bundling pulls in
  // its old zip dependencies (fstream/rimraf) and Turbopack warns about them.
  serverExternalPackages: ["exceljs"],
  // Vercel Services does not serve the /_next/image optimizer (it returns 404),
  // so next/image serves the files from public/ as they are. The images are
  // small local logos, so nothing is lost.
  images: { unoptimized: true },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
