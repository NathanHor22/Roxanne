"use client";

import { useId, type CSSProperties } from "react";
import { LOCALE_OPTIONS, parseLocale } from "@/lib/i18n";
import { useLanguage } from "./LanguageProvider";

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export type LanguageSwitcherProps = {
  className?: string;
  id?: string;
  disabled?: boolean;
  showLabel?: boolean;
  compact?: boolean;
};

export function LanguageSwitcher({
  className,
  id,
  disabled = false,
  showLabel = false,
  compact = false,
}: LanguageSwitcherProps) {
  const generatedId = useId();
  const selectId = id ?? `lantern-language-${generatedId.replaceAll(":", "")}`;
  const { dict, locale, setLocale } = useLanguage();
  const rootClassName = [
    "language-switcher",
    compact ? "language-switcher--compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <label htmlFor={selectId} className={rootClassName}>
      <span style={showLabel ? undefined : visuallyHidden}>{dict.settings.language}</span>
      <select
        id={selectId}
        aria-label={dict.settings.language}
        value={locale}
        disabled={disabled}
        onChange={(event) => setLocale(parseLocale(event.currentTarget.value))}
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} lang={option.htmlLang}>
            {compact ? option.shortLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
