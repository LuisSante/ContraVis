import { diffWordsWithSpace } from 'diff';
import { EMPTY_CHANGE_LOG } from '$lib/constant';
import type { ChangeLogState, TokenDiffSegment } from '$lib/types/document';
import { normalizeEditableText } from '$lib/utils/docx/dom';

export function buildChangeLog(committedText: string, currentText: string): ChangeLogState {
	const oldText = normalizeEditableText(committedText);
	const newText = normalizeEditableText(currentText);
	if (oldText === newText) return { ...EMPTY_CHANGE_LOG, oldSegments: [], newSegments: [] };

	const oldSegments: TokenDiffSegment[] = [];
	const newSegments: TokenDiffSegment[] = [];
	let hasChanges = false;

	for (const segment of diffWordsWithSpace(oldText, newText)) {
		if (segment.removed) {
			oldSegments.push({ value: segment.value, changed: true });
			hasChanges = true;
			continue;
		}

		if (segment.added) {
			newSegments.push({ value: segment.value, changed: true });
			hasChanges = true;
			continue;
		}

		oldSegments.push({ value: segment.value, changed: false });
		newSegments.push({ value: segment.value, changed: false });
	}

	return { hasChanges, oldSegments, newSegments };
}
