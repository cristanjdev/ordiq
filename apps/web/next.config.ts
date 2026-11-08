import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@ordiq/contracts"],
  // Loaded from node_modules at runtime instead of bundled; bundling pulls in
  // its old zip dependencies (fstream/rimraf) and Turbopack warns about them.
  serverExternalPackages: ["exceljs"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
