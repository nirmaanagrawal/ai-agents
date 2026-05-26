/**
 * Wizard type definitions — shared between every agent that uses a
 * conversational ICP-builder before its main run (Lead Qualifier,
 * GCC Prospector, future agents).
 *
 * Each agent provides a `WizardDefinition` consisting of:
 *   - title:     short header above the progress bar
 *   - questions: ordered array of MCQ questions
 *   - composeIcp: converts the answer map into the structured ICP
 *                 string that goes to the agent as `context`
 *
 * Per-agent wizards live in `lib/wizard/{agent-slug}.ts` and are
 * imported by the chat component on demand.
 */

interface QuestionBase {
  id: string;
  prompt: string;
  helpText?: string;
  /** When true, "Skip" is hidden and the visitor must answer. */
  required?: boolean;
}

/** Free-text question. Kept in the union so future agents can still
 *  use a typing box for nuanced answers if needed. Today's wizards
 *  are all MCQ. */
export interface FreeTextQuestion extends QuestionBase {
  kind: 'text';
  placeholder?: string;
  multiline?: boolean;
}

export interface SingleChoiceQuestion extends QuestionBase {
  kind: 'single';
  options: string[];
  /** Show a free-text "Other" input below the options. */
  allowOther?: boolean;
}

export interface MultiChoiceQuestion extends QuestionBase {
  kind: 'multi';
  options: string[];
  allowOther?: boolean;
}

export type Question = FreeTextQuestion | SingleChoiceQuestion | MultiChoiceQuestion;

/** Visitor's answer to a single question. Single-choice → string,
 *  multi → array, free-text → string. */
export type Answer = string | string[];

export interface WizardDefinition {
  /** Short header text shown above the progress bar (e.g. "ICP setup"). */
  title: string;
  questions: Question[];
  /** Render the answer map into the structured ICP string that gets
   *  sent to the agent as its `context` input. */
  composeIcp: (answers: Record<string, Answer>) => string;
}
