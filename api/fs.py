from __future__ import annotations

from helpers.api import ApiHandler, Input, Output, Request, Response
from usr.plugins.total_commander_plugin.helpers.fs_ops import (
    FsError,
    compress_paths,
    copy_paths,
    create_file,
    delete_paths,
    extract_archive,
    list_dir,
    mkdir,
    move_paths,
    read_text,
    rename_path,
    write_text,
)


class Fs(ApiHandler):
    async def process(self, input: Input, request: Request) -> Output:
        action = str(input.get("action", "")).strip().lower()

        try:
            if action == "list":
                path = str(input.get("path", "/"))
                return {"ok": True, **list_dir(path)}

            if action == "mkdir":
                path = str(input.get("path", ""))
                name = str(input.get("name", ""))
                return {"ok": True, **mkdir(path, name)}

            if action == "create_file":
                path = str(input.get("path", ""))
                name = str(input.get("name", ""))
                return {"ok": True, **create_file(path, name)}

            if action == "delete":
                paths = input.get("paths", [])
                return {"ok": True, **delete_paths(paths)}

            if action == "copy":
                sources = input.get("sources", [])
                destination = str(input.get("destination", ""))
                overwrite = bool(input.get("overwrite", False))
                return {
                    "ok": True,
                    **copy_paths(sources, destination, overwrite=overwrite),
                }

            if action == "move":
                sources = input.get("sources", [])
                destination = str(input.get("destination", ""))
                overwrite = bool(input.get("overwrite", False))
                return {
                    "ok": True,
                    **move_paths(sources, destination, overwrite=overwrite),
                }

            if action == "rename":
                path = str(input.get("path", ""))
                new_name = str(input.get("new_name", ""))
                overwrite = bool(input.get("overwrite", False))
                return {
                    "ok": True,
                    **rename_path(path, new_name, overwrite=overwrite),
                }

            if action == "read_text":
                path = str(input.get("path", ""))
                max_bytes = int(input.get("max_bytes", 1_048_576))
                return {"ok": True, **read_text(path, max_bytes=max_bytes)}

            if action == "write_text":
                path = str(input.get("path", ""))
                content = input.get("content", "")
                return {"ok": True, **write_text(path, content)}

            if action == "compress":
                sources = input.get("sources", [])
                archive_path = str(input.get("archive_path", ""))
                fmt = str(input.get("format", "zip"))
                return {
                    "ok": True,
                    **compress_paths(sources, archive_path=archive_path, fmt=fmt),
                }

            if action == "extract":
                archive_path = str(input.get("archive_path", ""))
                destination = str(input.get("destination", ""))
                return {
                    "ok": True,
                    **extract_archive(archive_path, destination),
                }

            return Response("Unknown action", 400)

        except FsError as e:
            return Response(str(e), 400)
        except Exception as e:
            return Response(f"Unhandled filesystem error: {e}", 500)
