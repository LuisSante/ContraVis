export { appendChildren, normalizeEditableText, setStyles, toNodeList } from '$lib/utils/docx/dom';

export { resolveDocx4jsFromRequire } from '$lib/utils/docx/loader';

export {
	getParagraphStyles,
	getRunStyles,
	getSectionLayout,
	hasOnlySectionBreak,
	parseBorder
} from '$lib/utils/docx/styles';

export {
	findChild,
	getAttr,
	localName,
	normalizeColor,
	isOn,
	toBorderPx,
	toNumber,
	toTwipsPx
} from '$lib/utils/docx/xml';
