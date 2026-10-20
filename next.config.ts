import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma client should not be bundled for the browser
  serverExternalPackages: ["@prisma/client", "@aws-sdk/client-s3"],
  output: "standalone",
};

export default nextConfig;
