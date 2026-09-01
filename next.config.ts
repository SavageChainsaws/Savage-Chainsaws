import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB, which the "Upload Invoice / Photo" field on the
    // status-update form can exceed for a PDF (unlike the photo field,
    // which is resized client-side before upload, a PDF is sent as-is).
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
