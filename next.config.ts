import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  sassOptions: {
    loadPaths: [path.join(process.cwd(), "src/styles")],
    // Có sẵn `bp.$bp-*` ở mọi .module.scss mà không cần tự @use từng file.
    additionalData: `@use "breakpoints" as bp;`,
  },
};

export default nextConfig;
