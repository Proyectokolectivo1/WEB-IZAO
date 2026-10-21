"""SQLite local: cola y bitácora. Es lo que impide imprimir dos veces aunque el agente se reinicie.

Fases de un trabajo:
  new         reclamado, aún sin PDF
  downloaded  PDF guardado, nada enviado a la impresora
  printing    hay (o hubo) un intento enviado a SumatraPDF; se escribe ANTES de lanzarlo
  finished    decisión final tomada (result_status = printed | failed); falta (o ya se hizo) avisar al servidor

Regla de oro: un trabajo en `printing` tras un reinicio NO se vuelve a imprimir; se cierra como `failed`
con un mensaje claro, y la reimpresión es manual desde el panel.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  order_number TEXT,
  reprint INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  phase TEXT NOT NULL DEFAULT 'new',
  attempts INTEGER NOT NULL DEFAULT 0,
  pdf_path TEXT,
  result_status TEXT,
  result_error TEXT,
  screenshot_path TEXT,
  reported INTEGER NOT NULL DEFAULT 0,
  report_tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  printed_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_order_idx ON jobs(order_number, type);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

INTERRUPTED_MESSAGE = (
    "El agente se reinició mientras imprimía este trabajo. Por seguridad no se volvió a imprimir: "
    "revise si la guía salió y, si hace falta, use Reimprimir en el panel."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Store:
    def __init__(self, path: Path | str):
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")  # el estado `printing` debe estar en disco antes de imprimir
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ---- trabajos
    def get(self, job_id: str) -> sqlite3.Row | None:
        with self._lock:
            return self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()

    def register(self, job_id: str, type_: str, order_number: str | None, reprint: bool, claimed_at: str | None) -> sqlite3.Row:
        now = _now()
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO jobs (id, type, order_number, reprint, claimed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (job_id, type_, order_number, int(reprint), claimed_at, now, now),
            )
            row = self.get(job_id)
        assert row is not None
        return row

    def _update(self, job_id: str, **fields: Any) -> None:
        fields["updated_at"] = _now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))

    def set_downloaded(self, job_id: str, pdf_path: str) -> None:
        self._update(job_id, phase="downloaded", pdf_path=pdf_path)

    def begin_attempt(self, job_id: str) -> int:
        """Cuenta el intento y pasa a `printing` en una sola transacción, antes de tocar la impresora."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute(
                    "UPDATE jobs SET attempts = attempts + 1, phase = 'printing', updated_at = ? WHERE id = ? AND phase IN ('downloaded','printing')",
                    (_now(), job_id),
                )
                row = self._db.execute("SELECT attempts FROM jobs WHERE id = ?", (job_id,)).fetchone()
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise
        return int(row["attempts"])

    def back_to_downloaded(self, job_id: str) -> None:
        """Un intento falló con certeza (código de salida de error): se puede volver a intentar."""
        self._update(job_id, phase="downloaded")

    def finish(self, job_id: str, status: str, error: str | None = None, screenshot_path: str | None = None) -> None:
        extra: dict[str, Any] = {}
        if status == "printed":
            extra["printed_at"] = _now()
        self._update(job_id, phase="finished", result_status=status, result_error=error, screenshot_path=screenshot_path, **extra)

    def mark_reported(self, job_id: str) -> None:
        self._update(job_id, reported=1)

    def bump_report_tries(self, job_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE jobs SET report_tries = report_tries + 1 WHERE id = ?", (job_id,))

    def recover_interrupted(self) -> list[str]:
        """Al arrancar: todo `printing` quedó a medias. No se reimprime; se cierra como fallido."""
        with self._lock:
            ids = [r["id"] for r in self._db.execute("SELECT id FROM jobs WHERE phase = 'printing'")]
        for job_id in ids:
            self.finish(job_id, "failed", INTERRUPTED_MESSAGE)
        return ids

    def unfinished(self) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._db.execute("SELECT * FROM jobs WHERE phase IN ('new','downloaded') ORDER BY created_at"))

    def pending_reports(self) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._db.execute("SELECT * FROM jobs WHERE phase = 'finished' AND reported = 0 ORDER BY created_at"))

    def queue_size(self) -> int:
        """Trabajos locales sin cerrar del todo (sin decisión final o sin avisar al servidor)."""
        with self._lock:
            return int(self._db.execute("SELECT COUNT(*) FROM jobs WHERE reported = 0").fetchone()[0])

    def printed_for_order(self, order_number: str, type_: str, exclude_id: str) -> sqlite3.Row | None:
        with self._lock:
            return self._db.execute(
                "SELECT * FROM jobs WHERE order_number = ? AND type = ? AND id != ? AND result_status = 'printed' LIMIT 1",
                (order_number, type_, exclude_id),
            ).fetchone()

    def old_pdf_paths(self, older_than_iso: str) -> list[str]:
        with self._lock:
            return [r["pdf_path"] for r in self._db.execute(
                "SELECT pdf_path FROM jobs WHERE pdf_path IS NOT NULL AND phase = 'finished' AND reported = 1 AND updated_at < ?",
                (older_than_iso,),
            )]

    def purge_old(self, older_than_iso: str) -> int:
        with self._lock:
            cur = self._db.execute("DELETE FROM jobs WHERE phase = 'finished' AND reported = 1 AND updated_at < ?", (older_than_iso,))
            return cur.rowcount

    # ---- meta
    def meta_get(self, key: str) -> str | None:
        with self._lock:
            r = self._db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return r["value"] if r else None

    def meta_set(self, key: str, value: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
