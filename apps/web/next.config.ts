import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@ordiq/contracts"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
