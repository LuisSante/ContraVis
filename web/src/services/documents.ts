import { api } from '@/lib/api';
import { useDocumentStore } from '@/stores/document';
import type { DocumentMeta } from '@/types/document';

/** Lista los documentos del dataset CUAD disponibles en el backend. */
export async function listDocuments(): Promise<DocumentMeta[]> {
	const response = await api.get<DocumentMeta[]>('/list_documents');
	return response.data;
}

/** Descarga el binario `.docx` de un documento (para parsearlo con docx4js en el navegador). */
export async function fetchDocumentFile(docId: string): Promise<ArrayBuffer> {
	const response = await api.get<ArrayBuffer>(
		`/document_file/${encodeURIComponent(docId)}`,
		{ responseType: 'arraybuffer' }
	);
	return response.data;
}

/**
 * Resuelve la metadata de un documento por id. Usa el documento ya seleccionado
 * en el store si coincide; de lo contrario consulta la lista y lo cachea.
 */
export async function resolveDocumentMeta(docId: string): Promise<DocumentMeta | null> {
	const { currentDocument, setCurrentDocument } = useDocumentStore.getState();
	if (currentDocument?.id === docId) return currentDocument;

	try {
		const documents = await listDocuments();
		const found = documents.find((doc) => doc.id === docId) ?? null;
		if (found) setCurrentDocument(found);
		return found;
	} catch {
		return null;
	}
}
