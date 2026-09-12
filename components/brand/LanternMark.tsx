type LanternMarkProps = {
  className?: string;
  label?: string;
};

/** Original Lantern aperture mark used across the web app and device setup. */
export function LanternMark({ className, label }: LanternMarkProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      fill="none"
      role={label ? "img" : undefined}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="23" stroke="currentColor" strokeWidth="4" />
      <circle cx="32" cy="32" r="10" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="3" />
      <path d="M32 3v10M32 51v10M3 32h10M51 32h10" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
      <path d="m15 15 7 7m20 20 7 7m0-34-7 7M22 42l-7 7" stroke="currentColor" strokeLinecap="round" strokeOpacity="0.55" strokeWidth="2" />
    </svg>
  );
}
