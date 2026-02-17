export interface DocumentMeta {
	id: string;
	name: string;
	full_path: string;
	processed: boolean;
}

interface ParagraphStyle {
	font_name: string | null;
	font_size: number | null;
	bold: boolean;
	italic: boolean;
	alignment: 'Left' | 'Center' | 'Right' | 'Justify' | 'None';
}

export interface Paragraph {
	id: string;
	text: string;
	original: string;
	style: ParagraphStyle;
	modified?: boolean;
}
