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
  async headers() {
    return [
      {
        // Static files are otherwise cached aggressively - without this, a
        // deployed sw.js update can take a long time to actually reach
        // returning users, since the browser keeps using its cached copy.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ]
  },
};

export default nextConfig;
