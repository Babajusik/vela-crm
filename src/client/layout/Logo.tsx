export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#12263A" />
      <path d="M33 10 L33 46 L13 46 Z" fill="#2CC5AF" />
      <path d="M37 18 L37 46 L53 46 Z" fill="#FF6B57" />
      <path d="M10 50 Q32 58 54 50" stroke="#2CC5AF" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
