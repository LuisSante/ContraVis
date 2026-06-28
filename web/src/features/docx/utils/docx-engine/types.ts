/**
 * Tipos propios del motor de render docx. Standalone (sin dependencias de la app)
 * para que el motor sea portable a otro proyecto. Son estructuralmente idénticos
 * a los de `@/types`, así que TS los acepta en el límite (callbacks de render).
 */

/** Nodo del árbol XML de OOXML, tal como lo expone docx4js. */
export type XmlNode = {
	name?: string;
	attribs?: Record<string, string>;
	children?: XmlNode[];
	type?: string;
	data?: string;
};

export type Docx4jsDocument = {
	render: (
		factory: (type: string, props: Record<string, unknown>, children: unknown) => unknown,
		identify?: (
			node: XmlNode,
			officeDocument: {
				constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown };
			}
		) => unknown
	) => unknown;
	release?: () => void;
};

export type Docx4jsBrowserModule = {
	docx: {
		load: (file: ArrayBuffer) => Promise<Docx4jsDocument>;
	};
};

/** Modelo de párrafo que el motor expone a quien lo consume. */
export interface ParagraphNode {
	id: string;
	documentId: string;
	text: string;
	paragraph_enum: number;
	page: number;
	relationsCount: number;
}

export type ParagraphKind = 'paragraph' | 'heading' | 'list';

/** Estado de edición por párrafo (lo usa el plugin de edición de la app). */
export type ParagraphEditState = {
	committed: string;
	current: string;
	editedSinceCommit: boolean;
};
