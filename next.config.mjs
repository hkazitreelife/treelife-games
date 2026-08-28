/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Serve the Jump Quest SPA shell at a clean directory-style URL so its
      // router (basepath /games/jumpquest/) sees "/" and matches the index route.
      { source: "/games/jumpquest", destination: "/games/jumpquest/index.html" },
    ];
  },
};

export default nextConfig;
