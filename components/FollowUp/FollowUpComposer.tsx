"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, MessageCircle, Sparkles, X } from "lucide-react";
import type { Contact, FollowUp } from "@/lib/types";
import { useLanguage } from "@/components/i18n/LanguageProvider";

interface FollowUpComposerProps {
  followUp: FollowUp | null;
  contact?: Contact;
  onClose: () => void;
  onPrepare: (followUp: FollowUp, contact?: Contact) => Promise<{
    body: string;
    provider: "devin" | "fallback";
    warning?: string;
  }>;
  onSend: (followUp: FollowUp, body: string) => Promise<void>;
}

export function FollowUpComposer({ followUp, contact, onClose, onPrepare, onSend }: FollowUpComposerProps) {
  const { dict } = useLanguage();
  const [body, setBody] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [preparationNote, setPreparationNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBody(followUp?.draft || `Hi ${contact?.name?.split(" ")[0] || "there"}, great speaking earlier. I’m following up on ${followUp?.description.toLowerCase() || "our conversation"}.`);
    setPreparationNote(null);
    setError(null);
    setSent(false);
    if (!followUp) return () => { cancelled = true; };

    setPreparing(true);
    void onPrepare(followUp, contact)
      .then((proposal) => {
        if (cancelled) return;
        setBody(proposal.body);
        setPreparationNote(
          proposal.warning ||
            (proposal.provider === "devin" ? dict.followUp.preparedByDevin : null),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : dict.errors.generic);
        }
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });

    return () => { cancelled = true; };
  }, [contact, dict.errors.generic, dict.followUp.preparedByDevin, followUp, onPrepare]);

  if (!followUp) return null;
  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.section className="composer" initial={{ y: 24, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }}>
          <header className="composer__header">
            <span className="composer__icon"><Sparkles /></span>
            <div><p className="section-kicker">{dict.followUp.draft}</p><h2>{contact?.name || "Follow-up"}</h2><p>{contact?.company}</p></div>
            <button type="button" className="icon-button" onClick={onClose} aria-label={dict.common.close}><X /></button>
          </header>
          {sent ? (
            <motion.div className="composer__sent" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}><span><Check /></span><h3>{dict.followUp.sent}</h3><p>{dict.followUp.delivered}</p></motion.div>
          ) : (
            <>
              <label className="composer__field"><span>{preparing ? dict.followUp.preparing : dict.followUp.message}</span><textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} disabled={preparing} /></label>
              {preparationNote ? <p className="composer__note">{preparationNote}</p> : null}
              {error ? <p className="composer__error" role="alert">{error}</p> : null}
              <p className="composer__safety"><MessageCircle /> {dict.followUp.safety} <strong>+60 11-5444 4038</strong>.</p>
              <footer className="composer__footer">
                <button type="button" className="button button--ghost" onClick={onClose}>{dict.common.cancel}</button>
                <button type="button" className="button button--primary" disabled={preparing || sending || !body.trim()} onClick={async () => { setSending(true); setError(null); try { await onSend(followUp, body); setSent(true); } catch (cause) { setError(cause instanceof Error ? cause.message : dict.errors.sendFailed); } finally { setSending(false); } }}><MessageCircle />{sending ? dict.followUp.sending : dict.followUp.sendWhatsApp}</button>
              </footer>
            </>
          )}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}
