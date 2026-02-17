from pathlib import Path
from schemas.document import DatasetDocument
from utils.config import Config
import logging

logger = logging.getLogger(__name__)

class DocumentStore:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DocumentStore, cls).__new__(cls)
            cls._instance._documents = []
            cls._instance._path_map = {}
            cls._instance._initialized = False
        return cls._instance

    from pathlib import Path

    def iter_pdfs(self, base_dir: Path):
        return (
            p for p in base_dir.rglob("*")
            if p.is_file() and p.suffix.lower() == ".pdf"
        )

    def initialize(self):
        if self._initialized:
            return

        logger.info("Initializing DocumentStore...")
        if not Config.CUAD_PDF_DIR.exists():
            logger.error(f"Dataset directory not found: {Config.CUAD_PDF_DIR}")
            return

        documents = []
        path_map = {}

        for pdf_path in self.iter_pdfs(Config.CUAD_PDF_DIR):
            doc = DatasetDocument(
                id=pdf_path.stem,
                name=pdf_path.name,
                full_path=str(pdf_path.resolve()),
                origin="dataset",
                processed=False
            )
            documents.append(doc)
            path_map[pdf_path.stem] = pdf_path

        self._documents = documents
        self._path_map = path_map
        self._initialized = True
        logger.info(f"DocumentStore initialized with {len(documents)} documents.")

    def get_documents(self) -> list[DatasetDocument]:
        return self._documents

    def get_path(self, doc_id: str) -> Path | None:
        return self._path_map.get(doc_id)