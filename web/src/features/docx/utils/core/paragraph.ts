export { appendChildren, normalizeEditableText, setStyles, toNodeList } from '@/features/docx/utils/core/dom';

export { resolveDocx4jsFromRequire } from '@/features/docx/utils/core/loader';

export {
	getParagraphStyles,
	getRunStyles,
	getSectionLayout,
	hasOnlySectionBreak,
	parseBorder
} from '@/features/docx/utils/core/styles';

export {
	findChild,
	getAttr,
	localName,
	normalizeColor,
	isOn,
	toBorderPx,
	toNumber,
	toTwipsPx
} from '@/features/docx/utils/core/xml';
