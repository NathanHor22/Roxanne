type QuipusMarkProps = { className?: string; label?: string };

/** Connected threads: the same single-colour mark is used on screen and device. */
export function QuipusMark({ className, label }: QuipusMarkProps) {
  return (
    <svg viewBox="0 0 120 76" fill="none" className={className}
      aria-hidden={label ? undefined : true} aria-label={label}
      role={label ? "img" : undefined} xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M60 61C54 32 35 13 8 10M60 61C48 37 33 27 12 24M60 61C47 45 34 39 20 38M60 61C48 53 40 50 31 50M60 61L45 60" />
        <path d="M60 61C66 32 85 13 112 10M60 61C72 37 87 27 108 24M60 61C73 45 86 39 100 38M60 61C72 53 80 50 89 50M60 61L75 60" />
        <path d="M57 62C57 57 63 57 63 62C63 67 57 67 57 62ZM60 66V72" />
      </g>
    </svg>
  );
}
