"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { TranscriptSegment } from "@/lib/types";

interface TranscriptAccordionProps { label: string; segments?: TranscriptSegment[]; }

export function TranscriptAccordion({ label, segments = [] }: TranscriptAccordionProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="transcript">
      <button type="button" className="transcript__trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{label}</span><ChevronDown className={open ? "is-open" : ""} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div className="transcript__content" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ height: { duration: 0.22 }, opacity: { duration: 0.16 } }}>
            <div className="transcript__inner">
              {segments.length ? segments.map((segment, index) => (
                <motion.div key={`${segment.speaker}-${index}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.035 }}>
                  <strong>{segment.speaker}</strong><p>{segment.text}</p>
                </motion.div>
              )) : <p className="empty-copy">No transcript attached yet.</p>}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
