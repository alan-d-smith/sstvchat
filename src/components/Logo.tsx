/**
 * Original SSTV Chat mark: a pebble-shaped radio robot with a tilted antenna, dot eyes and a
 * sine-wave mouth, filled grey with a dark outline on a yellow rounded square.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="SSTV Chat">
      <rect width="32" height="32" rx="8" fill="#FFFC00" />
      <g
        transform="translate(16 16.6) scale(0.74) translate(-16 -15.5)"
        stroke="#111111"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15.5 10.5 18.2 5.9" fill="none" />
        <circle cx="19.1" cy="4.3" r="1.7" fill="#B8B8B8" />
        <path
          d="M16 10.5c7.5 0 12.5 3.2 12.5 9.5S24.5 28.5 16 28.5 3.5 26.3 3.5 20 8.5 10.5 16 10.5z"
          fill="#B8B8B8"
        />
        <circle cx="11.5" cy="17.6" r="1.4" fill="#111111" stroke="none" />
        <circle cx="20.5" cy="17.6" r="1.4" fill="#111111" stroke="none" />
        <path d="M9.5 23q1.625-2.2 3.25 0t3.25 0 3.25 0 3.25 0" fill="none" />
      </g>
    </svg>
  );
}
