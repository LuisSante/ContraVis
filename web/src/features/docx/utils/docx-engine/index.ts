/**
 * docx-engine — motor de render de documentos `.docx` fiel a Word.
 *
 * Autocontenido y agnóstico de la app: parsea (docx4js), aplica estilos OOXML
 * (fuentes métricas, interlineado, sangrías), pagina (incl. secciones
 * `continuous`) y monta DOM editable. Única dependencia externa: `docx4js`.
 *
 * Flujo típico de consumo:
 *   1. `loadBrowserDocx4js()` → parsear el ArrayBuffer del `.docx`.
 *   2. `createRenderer(docId, callbacks, deps, options)` → fábrica de nodos DOM.
 *   3. montar el DOM en un contenedor y `paginateRenderedSections(viewer)`.
 *   4. opcional: `detectDocxNoiseNodeIds(viewer)` para excluir cabeceras/pies
 *      repetidos y números de página de cualquier análisis posterior.
 *
 * Las features de la app (edición, badges, contradicciones) se enchufan vía los
 * `callbacks`/`deps` que se inyectan a `createRenderer` — el motor no las conoce.
 */

// Tipos del motor (modelo de párrafo, XML, docx4js).
export type {
	XmlNode,
	Docx4jsDocument,
	Docx4jsBrowserModule,
	ParagraphNode,
	ParagraphKind,
	ParagraphEditState
} from './types';

// Render.
export {
	createRenderer,
	type DocxRendererCallbacks,
	type DocxRendererDeps,
	type DocxRendererOptions
} from './renderer';

// Parseo del binario.
export { loadBrowserDocx4js } from './docx-page';

// Paginación (corte en páginas fieles + fusión de secciones continuous).
export { paginateRenderedSections } from './pagination';

// Detección de ruido (cabeceras/pies repetidos, números de página).
export { detectDocxNoiseNodeIds } from './noise';

// Estado de edición por párrafo (helper de modelo).
export { ensureNodeEditState } from './edit-state';
