export interface DocumentMeta {
	id: string;
	name: string;
	origin: 'dataset' | 'upload';
	processed: boolean;
}

// export interface Paragraph {
// 	id: string;
// 	documentId: string;
// 	page: number;
// 	paragraph_enum: number;
// 	text: string;
// 	bbox: [number, number, number, number]; // pdf.js coords
// 	relationsCount: number;
// }

export type Run = {
	text: string;
	size: number;
	font: string;
	bold: boolean;
	italic: boolean;
	color: number;
};

export type Paragraph = {
	id: string;
	page: number;
	bbox: [number, number, number, number]; // x0,y0,x1,y1 en coords PDF
	runs: Run[];
};

export interface ParagraphRelation {
	source: string;
	target: string;
	type: 'reference' | 'semantic_similarity';
	score?: number;
	ref_label?: string;
	ref_value?: string;
}

export interface ParagraphEdit {
	id: string;
	text: string;
}

export interface DocumentEditsPayload {
	documentId: string;
	paragraphs: ParagraphEdit[];
}
