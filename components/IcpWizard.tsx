'use client';

/**
 * IcpWizard — generic conversational MCQ wizard.
 *
 * Why this exists:
 *   A pasted free-text ICP is consistently vague — visitors paste 2-3
 *   sentences and the agent has nothing specific to match against.
 *   Walking the visitor through 12 targeted MCQs produces a structured
 *   ICP block the agent can score against precisely.
 *
 * Why it's generic now:
 *   Different agents need different question sets. Lead Qualifier needs
 *   sales-fit dimensions; GCC Prospector needs HQ-country + India-city
 *   + popularity-preference. Rather than fork the component, we accept
 *   a `wizard: WizardDefinition` prop and let each agent ship its own
 *   questions + composer in `lib/wizard/{agent-slug}.ts`.
 *
 * UX flow:
 *   IcpWizard owns its own internal state (current Q index + answers).
 *   On final submit it calls `onComplete(icpText)` and the parent uses
 *   that text as the `context` for the agent run.
 */
import { useMemo, useState } from 'react';
import type { Answer, WizardDefinition } from '@/lib/wizard/types';

export interface IcpWizardProps {
  wizard: WizardDefinition;
  onComplete: (icpText: string) => void;
  /** Optional escape hatch — if provided, shown on question 1 so the
   *  visitor can opt out of the wizard and type a free-form ICP. */
  onSkipWizard?: () => void;
}

export default function IcpWizard({ wizard, onComplete, onSkipWizard }: IcpWizardProps) {
  const { title, questions, composeIcp } = wizard;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [draft, setDraft] = useState<string>(''); // current text input or single-choice value
  const [picked, setPicked] = useState<Set<string>>(new Set()); // current multi-choice picks
  const [otherText, setOtherText] = useState<string>('');

  const q = questions[idx];
  const total = questions.length;
  const progress = Math.round(((idx + 1) / total) * 100);

  // Reset per-question state when we move forward/back. Pre-populates
  // from `answers` so going back-and-forward preserves previous picks.
  function resetForQuestion(newIdx: number) {
    const newQ = questions[newIdx];
    const existing = answers[newQ.id];
    if (newQ.kind === 'text') {
      setDraft(typeof existing === 'string' ? existing : '');
      setPicked(new Set());
      setOtherText('');
    } else if (newQ.kind === 'single') {
      setDraft(typeof existing === 'string' && newQ.options.includes(existing) ? existing : '');
      setOtherText(typeof existing === 'string' && !newQ.options.includes(existing) ? existing : '');
      setPicked(new Set());
    } else {
      const arr = Array.isArray(existing) ? existing : [];
      setPicked(new Set(arr.filter((v) => newQ.options.includes(v))));
      setOtherText(arr.find((v) => !newQ.options.includes(v)) ?? '');
      setDraft('');
    }
  }

  function commitCurrent(): Answer {
    if (q.kind === 'text') {
      return draft.trim();
    }
    if (q.kind === 'single') {
      if (draft) return draft;
      if (q.allowOther && otherText.trim()) return otherText.trim();
      return '';
    }
    // multi
    const arr = Array.from(picked);
    if (q.allowOther && otherText.trim()) arr.push(otherText.trim());
    return arr;
  }

  function next(skip = false) {
    const value: Answer = skip ? (q.kind === 'multi' ? [] : '') : commitCurrent();
    if (
      !skip &&
      q.required &&
      ((typeof value === 'string' && value.length === 0) ||
        (Array.isArray(value) && value.length === 0))
    ) {
      return; // Required question — don't advance.
    }
    const updated = { ...answers, [q.id]: value };
    setAnswers(updated);
    if (idx + 1 < total) {
      setIdx(idx + 1);
      resetForQuestion(idx + 1);
    } else {
      onComplete(composeIcp(updated));
    }
  }

  function back() {
    if (idx === 0) return;
    setIdx(idx - 1);
    resetForQuestion(idx - 1);
  }

  const canAdvance = useMemo(() => {
    if (!q.required) return true;
    if (q.kind === 'text') return draft.trim().length > 0;
    if (q.kind === 'single')
      return draft.length > 0 || (q.allowOther ? otherText.trim().length > 0 : false);
    return picked.size > 0 || (q.allowOther ? otherText.trim().length > 0 : false);
  }, [q, draft, picked, otherText]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-brand-card">
      {/* Progress bar — slightly taller + softer base */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider">
          <span className="text-brand-700">{title}</span>
          <span className="text-muted-foreground">
            {idx + 1} of {total}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand-gradient shadow-[0_0_8px_rgba(234,99,71,0.4)] transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <h3 className="font-serif text-xl font-semibold leading-tight text-foreground">
        {q.prompt}
      </h3>
      {q.helpText && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.helpText}</p>
      )}

      <div className="mt-4">
        {q.kind === 'text' &&
          (q.multiline ? (
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={q.placeholder}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ) : (
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={q.placeholder}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ))}

        {q.kind === 'single' && (
          <div className="space-y-2">
            {q.options.map((opt) => (
              <label
                key={opt}
                className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-all duration-200 ${
                  draft === opt
                    // Selected state — coral-tinted background that
                    // works in both light AND dark modes (brand colors
                    // are theme-agnostic, so we use primary/10 instead
                    // of the fixed brand-50 which was light-on-light
                    // in dark mode).
                    ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                    : 'border-border bg-card text-foreground/85 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-sm'
                }`}
              >
                <input
                  type="radio"
                  name={q.id}
                  value={opt}
                  checked={draft === opt}
                  onChange={() => setDraft(opt)}
                  className="accent-brand-500"
                />
                <span className="font-medium">{opt}</span>
              </label>
            ))}
            {q.allowOther && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => {
                  setOtherText(e.target.value);
                  if (e.target.value) setDraft('');
                }}
                placeholder="Other (type your own)"
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            )}
          </div>
        )}

        {q.kind === 'multi' && (
          <>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const active = picked.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      const updated = new Set(picked);
                      if (active) updated.delete(opt);
                      else updated.add(opt);
                      setPicked(updated);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                      active
                        // Active multi-select chip — hard coral
                        // gradient + white text reads well in both
                        // themes since both fills are theme-agnostic.
                        ? 'border-brand-500 bg-brand-gradient text-white shadow-brand-cta'
                        : 'border-border bg-card text-foreground/85 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-sm'
                    }`}
                  >
                    {active && <span className="mr-1">✓</span>}
                    {opt}
                  </button>
                );
              })}
            </div>
            {q.allowOther && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Add another (free text)"
                className="mt-3 w-full rounded-xl border border-border bg-background px-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            )}
          </>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <button
          type="button"
          onClick={back}
          disabled={idx === 0}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          ← Back
        </button>
        <div className="flex items-center gap-4">
          {!q.required && (
            <button
              type="button"
              onClick={() => next(true)}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip
            </button>
          )}
          {onSkipWizard && idx === 0 && (
            <button
              type="button"
              onClick={onSkipWizard}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              title="Type a free-text ICP instead"
            >
              I&apos;d rather type freely →
            </button>
          )}
          <button
            type="button"
            onClick={() => next(false)}
            disabled={!canAdvance}
            className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-brand-cta transition-all hover:-translate-y-0.5 hover:shadow-brand-cta-hover active:translate-y-0 disabled:cursor-not-allowed disabled:bg-none disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
          >
            {idx + 1 === total ? 'Finish →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
