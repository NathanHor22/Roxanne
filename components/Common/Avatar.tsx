interface AvatarProps {
  name: string;
  size?: "small" | "medium";
}

export function Avatar({ name, size = "medium" }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}
