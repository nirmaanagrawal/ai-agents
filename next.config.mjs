/**
 * Mounted at root now that we serve from the `agents.beanbag.ai` subdomain.
 *
 * Previously the app lived under `basePath: '/agent-marketplace'` so it
 * could be reverse-proxied behind www.beanbag.ai. With a dedicated
 * subdomain that's unnecessary — visitors hit `agents.beanbag.ai/` and
 * land directly on the marketplace grid.
 *
 * The redirect below preserves any older bookmarks / shared links that
 * still include the `/agent-marketplace` prefix. It's a 308 permanent
 * redirect so search engines + browser caches forget the old URL.
 */
const BASE_PATH = '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // basePath intentionally NOT set — app serves from /
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },

  // Don't let bundlers try to bundle the Agent SDK — it dynamically
  // resolves a per-platform CLI binary at runtime, and bundling breaks
  // that resolution. Marking it external means the function imports
  // it from `node_modules/` at runtime instead.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],

  // Force-include the SDK's per-platform binary in EVERY serverless
  // function that uses the Agent SDK. Next.js's file tracer doesn't
  // reliably detect optional/conditional binary deps, so we name them
  // explicitly per-route. New SDK-using routes must be added here.
  outputFileTracingIncludes: {
    '/api/agents/[slug]/process': [
      './node_modules/@anthropic-ai/claude-agent-sdk/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/**/*',
    ],
    '/api/agents/[slug]/build-wizard': [
      './node_modules/@anthropic-ai/claude-agent-sdk/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/**/*',
    ],
  },

  async redirects() {
    return [
      // Preserve any deep links from the old `/agent-marketplace/...`
      // basePath era. Anything that hit those URLs now redirects to the
      // same logical page at the root path.
      {
        source: '/agent-marketplace',
        destination: '/',
        permanent: true,
      },
      {
        source: '/agent-marketplace/:path*',
        destination: '/:path*',
        permanent: true,
      },
    ];
  },

  experimental: {
    // Raise body size for multipart file uploads (default is 1 MB).
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
