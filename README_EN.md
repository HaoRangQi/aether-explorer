# Aether Explorer

A macOS native file manager built with Tauri v2 + React 19 + Rust.
Combining Finder's operational capabilities with a modern design language — powered by Google **Material Design 3** visual language.

<p align="center">
  <strong>Casual follow, fateful updates</strong>
</p>

## Team

| Role | |
|------|-----|
| Captain | HaoRanQi |
| Designer | Gemini |
| Code Contributors | DeepSeek · Claude · GPT |

## Screenshots

### Light Mode

| List View | Grid View | Column View |
|:---:|:---:|:---:|
| ![List View](assets/images/ae-l-1.png) | ![Grid View](assets/images/ae-l-2.png) | ![Column View](assets/images/ae-l-3.png) |

### Dark Mode

![Dark Mode Preview](assets/images/ae-d-1.png)

### Settings

![Settings Preview](assets/images/ae-settings.png)

## Features

### File Browsing
- Real filesystem operations — browse, open, copy, move, rename, delete (to Trash)
- Three view modes — List, Grid, Miller Columns, with adjustable layout parameters
- File preview — thumbnails, text preview, Quick Look (Space key)
- Search & sort — real-time filtering, multi-column sorting, group by type/date

### macOS Deep Integration
- Native feel — frosted glass blur, light/dark/auto theme, 6 accent colors
- Quick Look — Space key triggers system native preview
- Trash — delete moves to Trash only, no physical deletion
- Terminal integration — open in Terminal via right-click, supports Terminal/iTerm etc.
- Full Disk Access — permission detection and guided authorization

### Windows & Tabs
- Multi-window — Cmd+N new window, cross-window tab drag & drop
- Tab management — detach, merge across windows, close protection
- Wallpaper background — custom URL or local image, adjustable blur

### Settings & Customization
- Appearance — theme mode, accent color, font, transparency, blur intensity
- Context menu — configurable extensions with custom terminal commands
- Language — Chinese/English, default Chinese

## Known Limitations

- File drag into folder not implemented yet
- Copy / Paste for files not implemented yet
- Arrow key navigation not supported yet
- App icon is a placeholder, needs professional design
- Column view sub-column cannot show preview panel ([BUG.md](./BUG.md))

Full task list at [TODO.md](./TODO.md).

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | Tauri v2 |
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 |
| Animation | Motion (Framer Motion) |
| Backend | Rust |
| i18n | i18next |
| Storage | Tauri Store + localStorage |

## Quick Start

### Prerequisites
- macOS 12+
- Node.js 18+
- Rust toolchain ([rustup](https://rustup.rs))

### Development

```bash
npm install        # Install dependencies
npm run dev        # Start frontend dev server
npx tauri dev      # Start Tauri desktop app
```

### Build

```bash
npm run build      # Build frontend
npx tauri build    # Build macOS .app
```

Output at `src-tauri/target/release/bundle/`.

## Project Structure

```
aether-explorer/
├── src/                    # React Frontend
│   ├── components/         # UI Components
│   │   ├── TopBar.tsx      # Tab bar (drag, cross-window transfer)
│   │   ├── Sidebar.tsx     # Sidebar (navigation, favorites)
│   │   ├── ExplorerView.tsx # File view (list/grid/column)
│   │   ├── SettingsView.tsx # Settings panel
│   │   └── TransferModal.tsx # Transfer progress
│   ├── i18n/               # Internationalization (zh/en)
│   ├── types.ts            # Type definitions
│   ├── constants.ts        # Constants
│   └── App.tsx             # Root component
├── src-tauri/              # Rust Backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Command registration
│   │   └── file_ops.rs     # Filesystem operations
│   └── tauri.conf.json     # Tauri config
├── assets/images/          # Screenshots
├── design/                 # Design resources
├── FEATURES.md             # Full feature list (84 items)
├── TODO.md                 # Upcoming features
├── BUG.md                  # Known bugs
└── package.json
```

## Feature List

See [FEATURES.md](./FEATURES.md) — 84 features across 12 tiers.

## Notes

- Delete operations only move files to macOS Trash, never physically delete
- Color tags are stored locally, not written to macOS extended attributes

## Troubleshooting

### "App is damaged and can't be opened"

When opening Aether Explorer for the first time, macOS may show "Aether Explorer.app is damaged and can't be opened. You should move it to the Trash."

**Cause:** This is a development build without Apple Developer code signing. macOS Gatekeeper blocks unsigned apps.

**Fix:**

```bash
# After moving the app to /Applications, run in Terminal:
sudo xattr -rd com.apple.quarantine /Applications/Aether\ Explorer.app
```

Or via System Settings:

1. Open **System Settings → Privacy & Security**
2. Scroll down to the **Security** section
3. Click the **Open Anyway** button
4. Click **Open** in the confirmation dialog

> Note: If you don't see the "Open Anyway" option, run the xattr command above first.

## License

MIT
