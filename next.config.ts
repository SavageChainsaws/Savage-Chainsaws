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
  async rewrites() {
    return [
      // Clean path for the social-bio Linktree page (public/linktree.html)
      // - /links is what actually goes in Instagram/TikTok bios, not the
      // long savage-chainsaws.vercel.app/linktree.html. A rewrite (not a
      // redirect) so the URL bar shows /links, not the .html file it
      // actually serves.
      {
        source: '/links',
        destination: '/linktree.html',
      },
    ]
  },
};

export default nextConfig;
