# Total Commander Plugin for Agent Zero

Dual-pane file commander inspired by Total Commander.

## Features

- Two independent file panes (left/right)
- Keyboard-first navigation and shortcuts
- Open directories, inspect file metadata
- Text file editor (read/write)
- Copy and move between panes
- Rename, delete, create folder, create file
- Archive operations:
  - Compress to `.zip`, `.tar`, `.tar.gz`
  - Extract `.zip`, `.tar`, `.tar.gz`, `.tgz`

## Keyboard Shortcuts

- `Tab` - switch active pane
- `Enter` - open selected item
- `Backspace` - go parent directory
- `F3` - view text file
- `F4` - edit text file
- `F5` - copy selected item to opposite pane
- `F6` - move selected item to opposite pane
- `F7` - create folder
- `F8` - delete selected item
- `Ctrl+N` - create file
- `Ctrl+R` - refresh both panes
- `Alt+F5` - compress selected item
- `Alt+F6` - extract selected archive
- `Esc` - close editor / close commander

## Install (local)

Copy this plugin folder to:

`/a0/usr/plugins/total_commander_plugin`

Then enable it in **Settings → Plugins**.

## Notes

- File operations run with Agent Zero backend permissions.
- Root path `/` is protected from destructive operations.
- Text editor is intended for small-to-medium text files.
