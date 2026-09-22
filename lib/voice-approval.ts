/** Deliberately stricter than recording consent. Background words cannot approve sending. */
export function voiceApprovalDecision(text: string): "yes" | "no" | "unknown" {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").replace(/\s+/gu, " ").trim();
  if (/\b(no|nope|cancel|stop|don't|do not|tak|tidak|jangan|batal)\b/u.test(normalized)) return "no";
  return /^(yes|yes please|yes confirm|confirm|go ahead|okay|ok|ya|ya boleh|boleh|setuju|teruskan)$/u.test(normalized) ? "yes" : "unknown";
}
