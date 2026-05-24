from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_safe_member(destination: Path, member_name: str) -> Path:
    if not member_name or Path(member_name).is_absolute():
        raise ValueError(f"unsafe archive path: {member_name!r}")
    target = (destination / member_name).resolve()
    root = destination.resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"archive path escapes temp directory: {member_name!r}")
    return target


def parse_json_file(path: Path) -> tuple[bool, str]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        return False, "not valid UTF-8"
    except json.JSONDecodeError as exc:
        return False, f"invalid JSON: {exc.msg}"
    if not isinstance(parsed, (dict, list)):
        return True, "valid JSON, top-level value is not object/list"
    return True, "valid JSON"


def inspect_extracted_file(path: Path, root: Path) -> dict[str, Any]:
    relative = path.relative_to(root).as_posix()
    item: dict[str, Any] = {
        "path": relative,
        "size": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    if relative.endswith(".json"):
        valid, detail = parse_json_file(path)
        item["json_valid"] = valid
        item["json_detail"] = detail
    elif relative.endswith(".jsonl"):
        valid = True
        records = 0
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                json.loads(line)
                records += 1
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            valid = False
            item["jsonl_detail"] = str(exc)
        item["jsonl_valid"] = valid
        item["records"] = records
    return item


def extract_tar(backup: Path, destination: Path) -> list[str]:
    names: list[str] = []
    with tarfile.open(backup, mode="r:*") as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"unsupported tar member type: {member.name!r}")
            target = ensure_safe_member(destination, member.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"cannot read tar member: {member.name!r}")
            with target.open("wb") as output:
                shutil.copyfileobj(source, output)
            names.append(member.name)
    return names


def extract_zip(backup: Path, destination: Path) -> list[str]:
    names: list[str] = []
    with zipfile.ZipFile(backup) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            target = ensure_safe_member(destination, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            names.append(info.filename)
    return names


def dry_run(backup: Path, *, keep_temp: bool = False) -> dict[str, Any]:
    if not backup.exists() or not backup.is_file():
        raise FileNotFoundError(f"backup file not found: {backup}")
    if backup.suffix == ".enc":
        raise ValueError("encrypted backups are not decrypted by this dry-run script; decrypt to a temporary file first")

    temp_dir = Path(tempfile.mkdtemp(prefix="chatgpt2api-restore-dry-run-"))
    kept = False
    try:
        suffixes = "".join(backup.suffixes).lower()
        if suffixes.endswith(".tar.gz") or backup.suffix.lower() in {".tgz", ".tar"}:
            kind = "tar"
            members = extract_tar(backup, temp_dir)
        elif backup.suffix.lower() == ".zip":
            kind = "zip"
            members = extract_zip(backup, temp_dir)
        elif backup.suffix.lower() == ".json":
            kind = "json"
            target = temp_dir / backup.name
            shutil.copyfile(backup, target)
            members = [backup.name]
        else:
            raise ValueError("supported formats: .tar.gz, .tgz, .tar, .zip, .json")

        files = [inspect_extracted_file(path, temp_dir) for path in sorted(temp_dir.rglob("*")) if path.is_file()]
        member_set = {item["path"] for item in files}
        warnings = []
        errors = []
        if kind in {"tar", "zip"} and "backup-metadata.json" not in member_set:
            warnings.append("backup-metadata.json not found")
        if not any(name.startswith("data/") or name.startswith("snapshots/") or name == "config.json" for name in member_set):
            errors.append("no data/, snapshots/, or config.json content found")
        for item in files:
            if item.get("json_valid") is False or item.get("jsonl_valid") is False:
                errors.append(f"invalid structured file: {item['path']}")

        kept = keep_temp
        return {
            "ok": not errors,
            "backup": str(backup),
            "format": kind,
            "temp_dir": str(temp_dir) if keep_temp else None,
            "members": len(members),
            "files": files,
            "warnings": warnings,
            "errors": errors,
        }
    finally:
        if not kept:
            shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dry-run a ChatGPT2API backup restore into a temporary directory without touching production data.",
    )
    parser.add_argument("backup", type=Path, help="Path to a local backup archive or JSON export")
    parser.add_argument("--keep-temp", action="store_true", help="Keep the temporary restore directory for inspection")
    args = parser.parse_args()

    try:
        report = dry_run(args.backup.resolve(), keep_temp=args.keep_temp)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
