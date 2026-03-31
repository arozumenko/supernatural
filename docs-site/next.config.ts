import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const isGithubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig = withMDX({
  reactStrictMode: true,
  output: isGithubPages ? 'export' : undefined,
  basePath: isGithubPages ? '/supernatural' : undefined,
  images: isGithubPages ? { unoptimized: true } : undefined,
});

export default nextConfig;
