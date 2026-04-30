/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mount the entire app under /agents. Lets us host this Vercel project
  // behind the main site's `/agents/*` rewrite without URL path collisions.
  // All pages, assets, and API routes get the prefix automatically — no
  // code changes needed inside components.
  basePath: '/agents',

  experimental: {
    // Raise body size for multipart file uploads (default is 1 MB).
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
