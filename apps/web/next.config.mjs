/** @type {import('next').NextConfig} */
const lanIp = process.env.LAN_IP || process.env.NEXT_PUBLIC_SOCKET_URL?.match(/\d+\.\d+\.\d+\.\d+/)?.[0];

const nextConfig = {
  // Pozwól Next.js dev na żądania z LAN (telefony) — wycisza ostrzeżenie Cross-origin /_next/*.
  // pnpm dev:lan ustawia NEXT_PUBLIC_SOCKET_URL z aktualnym IP, stąd je czytamy.
  allowedDevOrigins: lanIp ? [lanIp, `${lanIp}:3000`] : [],
};

export default nextConfig;
