from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy import Column, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


class ImageMetadataItemModel(Base):
    __tablename__ = "image_metadata_items"
    __table_args__ = (UniqueConstraint("collection", "item_key", name="uq_image_metadata_collection_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    collection = Column(String(128), nullable=False, index=True)
    item_key = Column(String(1024), nullable=False, index=True)
    data = Column(Text, nullable=False)


class DatabaseImageMetadataStorage:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.engine = create_engine(database_url, pool_pre_ping=True, pool_recycle=3600)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def load_map(self, collection: str) -> dict[str, Any]:
        session = self.Session()
        try:
            items: dict[str, Any] = {}
            rows = session.query(ImageMetadataItemModel).filter_by(collection=collection).all()
            for row in rows:
                try:
                    items[str(row.item_key)] = json.loads(str(row.data))
                except json.JSONDecodeError:
                    continue
            return items
        finally:
            session.close()

    def save_map(self, collection: str, items: dict[str, Any]) -> None:
        session = self.Session()
        try:
            session.query(ImageMetadataItemModel).filter_by(collection=collection).delete()
            for key, value in items.items():
                clean_key = str(key or "").strip()
                if not clean_key:
                    continue
                session.add(
                    ImageMetadataItemModel(
                        collection=collection,
                        item_key=clean_key,
                        data=json.dumps(value, ensure_ascii=False),
                    )
                )
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def upsert_item(self, collection: str, item_key: str, value: Any) -> None:
        clean_key = str(item_key or "").strip()
        if not clean_key:
            return
        session = self.Session()
        try:
            row = session.query(ImageMetadataItemModel).filter_by(collection=collection, item_key=clean_key).one_or_none()
            encoded = json.dumps(value, ensure_ascii=False)
            if row is None:
                session.add(ImageMetadataItemModel(collection=collection, item_key=clean_key, data=encoded))
            else:
                row.data = encoded
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_item(self, collection: str, item_key: str) -> None:
        clean_key = str(item_key or "").strip()
        if not clean_key:
            return
        session = self.Session()
        try:
            session.query(ImageMetadataItemModel).filter_by(collection=collection, item_key=clean_key).delete()
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


_storage: DatabaseImageMetadataStorage | None = None


def get_image_metadata_storage() -> DatabaseImageMetadataStorage | None:
    global _storage
    database_url = (
        os.getenv("IMAGE_METADATA_DATABASE_URL", "").strip()
        or os.getenv("POSTGRES_SYNC_DATABASE_URL", "").strip()
    )
    if not database_url:
        return None
    if _storage is None or _storage.database_url != database_url:
        _storage = DatabaseImageMetadataStorage(database_url)
    return _storage


def reset_image_metadata_storage_for_tests() -> None:
    global _storage
    _storage = None
