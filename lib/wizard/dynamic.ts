/**
 * Generic composer for dynamic (server-generated) wizards.
 *
 * Preset wizards each have a hand-rolled `composeIcp` that knows
 * exactly which question IDs exist and groups them into named
 * sections ("Firmographic Fit", "Pain Points", etc). Dynamic
 * wizards can't do that — the question IDs aren't known at build
 * time. So we fall back to a simple "render every answered question
 * as a bulleted section" template.
 *
 * The output is still a clean structured markdown block the agent
 * can read — sections by prompt, bullets for multi-select choices.
 */
import type {
  Answer,
  Question,
  WizardDefinition,
} from './types';

interface DynamicWizardPayload {
  title?: string;
  questions: Question[];
}

/**
 * Take the wizard JSON the server returned and produce a full
 * WizardDefinition (with a generic composer) the IcpWizard component
 * can consume.
 */
export function buildDynamicWizard(
  payload: DynamicWizardPayload,
  fallbackTitle = 'Screening criteria',
): WizardDefinition {
  return {
    title: payload.title || fallbackTitle,
    questions: payload.questions,
    composeIcp: (answers) => composeGeneric(payload.questions, answers),
  };
}

function composeGeneric(
  questions: Question[],
  answers: Record<string, Answer>,
): string {
  const lines: string[] = ['# SCREENING RUBRIC'];

  for (const q of questions) {
    const v = answers[q.id];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && !v.trim()) continue;

    // Strip the "N / 12 — " prefix that wizards add to prompts for
    // the progress UI. The rubric reads better without it.
    const heading = q.prompt.replace(/^\s*\d+\s*\/\s*\d+\s*—\s*/, '').trim();
    lines.push('', `## ${heading}`);

    if (Array.isArray(v)) {
      v.forEach((item) => lines.push(`- ${item}`));
    } else {
      lines.push(`- ${v}`);
    }
  }

  return lines.join('\n');
}
