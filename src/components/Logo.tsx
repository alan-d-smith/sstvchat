/**
 * Original SSTV Chat mark: a pebble-shaped radio blob with a tilted antenna, dot eyes and a
 * sine-wave mouth. Outline only, coloured by `currentColor` (sidebar sets it to light grey).
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="SSTV Chat"
    >
      <path d="M15.5 10.5 18.2 5.9" />
      <circle cx="19.1" cy="4.3" r="1.7" />
      <path d="M16 10.5c7.5 0 12.5 3.2 12.5 9.5S24.5 28.5 16 28.5 3.5 26.3 3.5 20 8.5 10.5 16 10.5z" />
      <circle cx="11.5" cy="17.6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="17.6" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9.5 23q1.625-2.2 3.25 0t3.25 0 3.25 0 3.25 0" />
    </svg>
  );
}
