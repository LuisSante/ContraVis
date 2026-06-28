import type { ContradictionParagraphResult } from '@/types/document';
import { buildChangeLog } from '@/features/docx/utils/edit/change-log';

/**
 * Helpers del chat de contradicción (quick-actions y sugerencia de fix). Port
 * fiel de las funciones inline del `+page.svelte` de Svelte:
 * - separación de la respuesta del LLM en cuerpo + bloque `ENTITIES:`
 * - entidades de respaldo cuando el modelo no devuelve ninguna
 * - notas de cambio resumidas para la tarjeta de fix
 */

/** Separa el cuerpo del mensaje del bloque `ENTITIES:` final, si existe. */
export function extractAnswerEntities(answer: string): { content: string; entities: string[] } {
	const normalized = answer.trim();
	if (!normalized) return { content: '', entities: [] };

	const entitiesMatch = normalized.match(/\n\s*ENTITIES:\s*([\s\S]*)$/i);
	if (!entitiesMatch) return { content: normalized, entities: [] };

	const entities = entitiesMatch[1]
		.split('\n')
		.map((line) => line.replace(/^[-*•]\s*/, '').trim())
		.filter((line) => line.length >= 2)
		.slice(0, 12);
	const content = normalized.slice(0, entitiesMatch.index ?? normalized.length).trim();
	return { content, entities: Array.from(new Set(entities)) };
}

/**
 * Construye un conjunto de entidades de respaldo a partir del texto del párrafo,
 * la evidencia y el motivo de la contradicción cuando el modelo no devuelve un
 * bloque `ENTITIES:`.
 */
export function buildFallbackContradictionEntities(
	paragraphText: string,
	contradiction: ContradictionParagraphResult
): string[] {
	const rawPool = [
		paragraphText,
		contradiction.evidence?.snippet_a ?? '',
		contradiction.evidence?.snippet_b ?? '',
		contradiction.brief_reason ?? '',
	]
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!rawPool) return [];

	const candidates = new Set<string>();
	const quoted = rawPool.match(/"([^"]{3,80})"/g) ?? [];
	for (const item of quoted) {
		const cleaned = item.replace(/"/g, '').trim();
		if (cleaned.length >= 3) candidates.add(cleaned);
	}

	const legalTerms = [
		'agreement',
		'applicable laws',
		'licensees',
		'subcontractors',
		'miltenyi products',
		'bellicum',
		'compliance',
		'minimum purchase',
		'purchase order',
		'written notice',
	];
	const lowerPool = rawPool.toLocaleLowerCase();
	for (const term of legalTerms) {
		if (lowerPool.includes(term)) candidates.add(term.replace(/\b\w/g, (c) => c.toUpperCase()));
	}

	const titleCase = rawPool.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/g) ?? [];
	for (const token of titleCase) candidates.add(token.trim());

	return Array.from(candidates)
		.map((item) => item.trim())
		.filter((item) => item.length >= 3)
		.slice(0, 10);
}

/** Compacta y trunca un fragmento de cambio para listarlo en la tarjeta de fix. */
export function truncateFixChangeText(text: string, maxLength = 120): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	if (compact.length <= maxLength) return compact;
	return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Deriva notas de cambio legibles ("Replace … with …") comparando el snippet
 * original con el reescrito.
 */
export function buildFixSuggestionChangeNotes(original: string, rewritten: string): string[] {
	const changeLog = buildChangeLog(original, rewritten);
	if (!changeLog.hasChanges) {
		return ['Review wording alignment with related clauses and payment/obligation timing.'];
	}

	const removed = changeLog.oldSegments
		.filter((segment) => segment.changed)
		.map((segment) => truncateFixChangeText(segment.value))
		.filter(Boolean);
	const added = changeLog.newSegments
		.filter((segment) => segment.changed)
		.map((segment) => truncateFixChangeText(segment.value))
		.filter(Boolean);

	const notes: string[] = [];
	const maxPairs = Math.min(3, Math.max(removed.length, added.length));
	for (let index = 0; index < maxPairs; index += 1) {
		const removedText = removed[index];
		const addedText = added[index];
		if (removedText && addedText) {
			notes.push(`Replace "${removedText}" with "${addedText}".`);
			continue;
		}
		if (addedText) {
			notes.push(`Add "${addedText}".`);
			continue;
		}
		if (removedText) {
			notes.push(`Remove "${removedText}".`);
		}
	}

	if (notes.length === 0) {
		notes.push('Refine language to keep one consistent legal statement and remove ambiguity.');
	}
	return notes;
}
