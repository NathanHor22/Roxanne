interface InsightBlockProps {
  label: string;
  value?: string | null;
  tone?: "default" | "accent";
}

export function InsightBlock({ label, value, tone = "default" }: InsightBlockProps) {
  if (!value) return null;
  return (
    <div className={`insight-block insight-block--${tone}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}
