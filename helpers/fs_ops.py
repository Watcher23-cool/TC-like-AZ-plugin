from __future__ import annotations

import os
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Any


ROOT_BLOCKLIST = {"/"}
TEXT_READ_DEFAULT_MAX = 1_048_576


class FsError(Exception):
    pass


def _real(path: str) -> str:
    if not isinstance(path, str) or not path.strip():
        raise FsError("Path is required")
    p = os.path.realpath(os.path.abspath(os.path.expanduser(path.strip())))
    return p


def _ensure_exists(path: str) -> None:
    if not os.path.exists(path):
        raise FsError(f"Path does not exist: {path}")


def _ensure_dir(path: str) -> None:
    if not os.path.isdir(path):
        raise FsError(f"Directory expected: {path}")


def _not_root(path: str) -> None:
    if path in ROOT_BLOCKLIST:
        raise FsError("Operation blocked for root path")


def _is_archive_name(name: str) -> bool:
    n = name.lower()
    return n.endswith(".zip") or n.endswith(".tar") or n.endswith(".tar.gz") or n.endswith(".tgz")


def _entry_payload(base_dir: str, entry: os.DirEntry[str]) -> dict[str, Any]:
    path = os.path.join(base_dir, entry.name)
    try:
        st = entry.stat(follow_symlinks=False)
        size = int(st.st_size)
        mtime = int(st.st_mtime)
    except OSError:
        size = 0
        mtime = 0

    is_dir = entry.is_dir(follow_symlinks=False)
    is_file = entry.is_file(follow_symlinks=False)
    is_symlink = entry.is_symlink()
    ext = ""
    if is_file:
        ext = os.path.splitext(entry.name)[1].lower()

    return {
        "name": entry.name,
        "path": path,
        "is_dir": is_dir,
        "is_file": is_file,
        "is_symlink": is_symlink,
        "size": size,
        "mtime": mtime,
        "ext": ext,
        "is_archive": is_file and _is_archive_name(entry.name),
    }


def list_dir(path: str) -> dict[str, Any]:
    cwd = _real(path)
    _ensure_exists(cwd)
    _ensure_dir(cwd)

    entries: list[dict[str, Any]] = []
    with os.scandir(cwd) as it:
        for entry in it:
            if entry.name in {".", ".."}:
                continue
            entries.append(_entry_payload(cwd, entry))

    return {"cwd": cwd, "entries": entries}


def mkdir(path: str, name: str) -> dict[str, Any]:
    base = _real(path)
    _ensure_dir(base)
    if not isinstance(name, str) or not name.strip():
        raise FsError("Folder name is required")
    new_path = _real(os.path.join(base, name.strip()))
    os.makedirs(new_path, exist_ok=False)
    return {"path": new_path}


def create_file(path: str, name: str) -> dict[str, Any]:
    base = _real(path)
    _ensure_dir(base)
    if not isinstance(name, str) or not name.strip():
        raise FsError("File name is required")
    new_path = _real(os.path.join(base, name.strip()))
    parent = os.path.dirname(new_path)
    _ensure_dir(parent)
    with open(new_path, "x", encoding="utf-8"):
        pass
    return {"path": new_path}


def delete_paths(paths: list[str]) -> dict[str, Any]:
    if not isinstance(paths, list) or not paths:
        raise FsError("'paths' must be a non-empty list")

    deleted: list[str] = []
    for raw in paths:
        p = _real(raw)
        _ensure_exists(p)
        _not_root(p)

        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        else:
            os.remove(p)
        deleted.append(p)

    return {"deleted": deleted}


def copy_paths(sources: list[str], destination_dir: str, overwrite: bool = False) -> dict[str, Any]:
    if not isinstance(sources, list) or not sources:
        raise FsError("'sources' must be a non-empty list")

    dst_dir = _real(destination_dir)
    _ensure_dir(dst_dir)

    copied: list[str] = []

    for raw_src in sources:
        src = _real(raw_src)
        _ensure_exists(src)

        name = os.path.basename(src.rstrip("/"))
        dst = os.path.join(dst_dir, name)

        if os.path.exists(dst):
            if not overwrite:
                raise FsError(f"Destination exists: {dst}")
            _not_root(dst)
            if os.path.isdir(dst) and not os.path.islink(dst):
                shutil.rmtree(dst)
            else:
                os.remove(dst)

        if os.path.isdir(src) and not os.path.islink(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

        copied.append(dst)

    return {"copied": copied}


def move_paths(sources: list[str], destination_dir: str, overwrite: bool = False) -> dict[str, Any]:
    if not isinstance(sources, list) or not sources:
        raise FsError("'sources' must be a non-empty list")

    dst_dir = _real(destination_dir)
    _ensure_dir(dst_dir)

    moved: list[str] = []

    for raw_src in sources:
        src = _real(raw_src)
        _ensure_exists(src)
        _not_root(src)

        name = os.path.basename(src.rstrip("/"))
        dst = os.path.join(dst_dir, name)

        if os.path.exists(dst):
            if not overwrite:
                raise FsError(f"Destination exists: {dst}")
            _not_root(dst)
            if os.path.isdir(dst) and not os.path.islink(dst):
                shutil.rmtree(dst)
            else:
                os.remove(dst)

        shutil.move(src, dst)
        moved.append(dst)

    return {"moved": moved}


def rename_path(path: str, new_name: str, overwrite: bool = False) -> dict[str, Any]:
    src = _real(path)
    _ensure_exists(src)
    _not_root(src)

    if not isinstance(new_name, str) or not new_name.strip():
        raise FsError("new_name is required")

    dst = _real(os.path.join(os.path.dirname(src), new_name.strip()))
    if os.path.exists(dst):
        if not overwrite:
            raise FsError(f"Destination exists: {dst}")
        _not_root(dst)
        if os.path.isdir(dst) and not os.path.islink(dst):
            shutil.rmtree(dst)
        else:
            os.remove(dst)

    os.rename(src, dst)
    return {"path": dst}


def read_text(path: str, max_bytes: int = TEXT_READ_DEFAULT_MAX) -> dict[str, Any]:
    p = _real(path)
    _ensure_exists(p)
    if not os.path.isfile(p):
        raise FsError(f"File expected: {p}")

    if not isinstance(max_bytes, int) or max_bytes <= 0:
        max_bytes = TEXT_READ_DEFAULT_MAX

    with open(p, "rb") as f:
        raw = f.read(max_bytes + 1)

    truncated = len(raw) > max_bytes
    if truncated:
        raw = raw[:max_bytes]

    try:
        text = raw.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
        encoding = "utf-8(replace)"

    return {
        "path": p,
        "content": text,
        "truncated": truncated,
        "encoding": encoding,
    }


def write_text(path: str, content: str) -> dict[str, Any]:
    p = _real(path)
    parent = os.path.dirname(p)
    _ensure_dir(parent)

    if not isinstance(content, str):
        raise FsError("content must be a string")

    with open(p, "w", encoding="utf-8") as f:
        f.write(content)

    return {"path": p, "bytes": len(content.encode("utf-8"))}


def _safe_extract_path(base: str, member_name: str) -> str:
    target = os.path.realpath(os.path.join(base, member_name))
    base_real = os.path.realpath(base)
    if not (target == base_real or target.startswith(base_real + os.sep)):
        raise FsError(f"Unsafe archive member path: {member_name}")
    return target


def compress_paths(sources: list[str], archive_path: str, fmt: str = "zip") -> dict[str, Any]:
    if not isinstance(sources, list) or not sources:
        raise FsError("'sources' must be a non-empty list")

    srcs = [_real(s) for s in sources]
    for src in srcs:
        _ensure_exists(src)

    archive = _real(archive_path)
    _not_root(archive)
    parent = os.path.dirname(archive)
    _ensure_dir(parent)

    fmt_n = (fmt or "zip").strip().lower()
    if fmt_n not in {"zip", "tar", "tar.gz"}:
        raise FsError("Unsupported format, use zip | tar | tar.gz")

    if os.path.exists(archive):
        os.remove(archive)

    if fmt_n == "zip":
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for src in srcs:
                src_path = Path(src)
                if src_path.is_dir() and not src_path.is_symlink():
                    for root, _, files in os.walk(src):
                        for file_name in files:
                            full = os.path.join(root, file_name)
                            arcname = os.path.relpath(full, start=os.path.dirname(src))
                            zf.write(full, arcname)
                else:
                    zf.write(src, os.path.basename(src))
    else:
        mode = "w:gz" if fmt_n == "tar.gz" else "w"
        with tarfile.open(archive, mode) as tf:
            for src in srcs:
                tf.add(src, arcname=os.path.basename(src))

    return {"archive": archive, "format": fmt_n}


def extract_archive(archive_path: str, destination_dir: str) -> dict[str, Any]:
    archive = _real(archive_path)
    dst = _real(destination_dir)
    _ensure_exists(archive)
    _ensure_dir(dst)

    extracted: list[str] = []

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive, "r") as zf:
            for info in zf.infolist():
                _safe_extract_path(dst, info.filename)
                extracted.append(info.filename)
            zf.extractall(dst)
        return {"destination": dst, "members": extracted, "type": "zip"}

    if tarfile.is_tarfile(archive):
        with tarfile.open(archive, "r:*") as tf:
            members = tf.getmembers()
            for member in members:
                _safe_extract_path(dst, member.name)
                extracted.append(member.name)
            tf.extractall(dst)
        return {"destination": dst, "members": extracted, "type": "tar"}

    raise FsError("Unsupported archive file")
