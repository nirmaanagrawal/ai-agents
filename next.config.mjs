// Mount the entire app under this prefix. Lets us host this Vercel project
// behind the main site's `/agent-marketplace/*` rewrite without URL path
// collisions. All Next.js-internal links (Link, Image, router.push) get the
// prefix automatically — but raw `fetch('/api/...')` calls do NOT, so we
// also expose the value as a NEXT_PUBLIC env so the client code can prepend
// it explicitly.
const BASE_PATH = '/agent-marketplace';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  experimental: {
    // Raise body size for multipart file uploads (default is 1 MB).
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
