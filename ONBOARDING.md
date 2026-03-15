# Welcome to Clipio

**Clipio** is a browser extension for Chrome and Firefox that turns your most-used texts into reusable snippets — and inserts them anywhere on the web the moment you type a shortcut.

Stop retyping the same emails, replies, code blocks, and boilerplate. Write it once, reuse it everywhere.

---

## Step 1 — Create Your First Snippet

Click the Clipio icon in your toolbar to open the popup. This is your snippet library.

```
┌──────────────────────────────────────────────────────────────────┐
│  🔍 Search snippets...                      [Add Snippet]  [⚙]  │
├──────────────────────┬───────────────────────────────────────────┤
│  Snippets            │                                           │
│  ─────────────────   │                                           │
│                      │                                           │
│                      │     No snippets yet                       │
│                      │     Create your first snippet to start    │
│                      │     saving and reusing text quickly.      │
│                      │                                           │
│                      │     [Create your first snippet]           │
│                      │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

Click **Add Snippet** or **Create your first snippet**. A creation form opens in the right pane:

```
┌──────────────────────────────────────────────────────────────────┐
│  New snippet                                                      │
│  ────────────────────────────────────────────────────────────    │
│  Name                                                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  e.g., Email Signature                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Shortcut                                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  e.g., /sig                                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Content                                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Start typing your snippet content here or use '/' for    │  │
│  │  commands...                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  [Cancel]                                          [Create]       │
└──────────────────────────────────────────────────────────────────┘
```

**Three fields is all it takes:**

- **Name** — a friendly label only you see (e.g., `Email Signature`)
- **Shortcut** — what you type to trigger it (e.g., `/sig`). No spaces allowed.
- **Content** — the text that gets inserted

---

## Step 2 — How Expansion Works (Real Gmail Example)

Once your snippet is saved, go to any website. Here's what it looks like composing a reply in **Gmail**:

**You type `/sig` at the end of your message:**

```
┌─────────────────────────────────────────────────────────────────┐
│  New Message                                                 ╳   │
├─────────────────────────────────────────────────────────────────┤
│  To       sarah@company.com                                     │
│  Subject  Re: Project update for Q2                             │
├─────────────────────────────────────────────────────────────────┤
│  Hi Sarah,                                                      │
│                                                                 │
│  Thanks for the update. I'll review the deck and get back       │
│  to you by end of day.                                          │
│                                                                 │
│  /sig█                                                          │
│                                                                 │
│  ─────────────────────────────────────────────────────────      │
│  Send    A  ╏  Formatting  ╏  📎  ╏  🔗  ╏  😊  ╏  ⋯  ╏ 🗑  │
└─────────────────────────────────────────────────────────────────┘
```

**You press Space — Clipio instantly replaces `/sig`:**

```
┌─────────────────────────────────────────────────────────────────┐
│  New Message                                                 ╳   │
├─────────────────────────────────────────────────────────────────┤
│  To       sarah@company.com                                     │
│  Subject  Re: Project update for Q2                             │
├─────────────────────────────────────────────────────────────────┤
│  Hi Sarah,                                                      │
│                                                                 │
│  Thanks for the update. I'll review the deck and get back       │
│  to you by end of day.                                          │
│                                                                 │
│  Best regards,                                                  │
│  Alex Johnson                                                   │
│  Senior Product Manager · Acme Corp                             │
│  alex@company.com · (555) 123-4567                              │
│  █                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────      │
│  Send    A  ╏  Formatting  ╏  📎  ╏  🔗  ╏  😊  ╏  ⋯  ╏ 🗑  │
└─────────────────────────────────────────────────────────────────┘
```

The shortcut is gone, the full signature is there, and your cursor is ready at the next line. No copy-paste, no switching windows, no clicking.

**Works wherever you type:** Gmail, Outlook Web, Notion, Linear, GitHub, Slack, your CMS, any `<input>`, `<textarea>`, or rich text field.

> **Smart boundary detection:** Clipio only expands when your shortcut is preceded by a space or a new line. Typing `resign` won't accidentally trigger `/sig`.

---

## Step 3 — Your Snippet Library (The Popup)

Once you have snippets saved, the popup becomes your command center:

```
┌──────────────────────────────────────────────────────────────────┐
│  🔍 Search snippets...                      [Add Snippet]  [⚙]  │
├──────────────────────┬───────────────────────────────────────────┤
│  Snippets            │  Email Signature                          │
│  ─────────────────   │  ───────────────────────────────────────  │
│  ▶ Email Signature   │  B  I  U  S  [⌘K]  [🖼]  [GIF]          │
│    /sig              │                                           │
│    Best regards, A…  │  Best regards,                            │
│                      │  Alex Johnson                             │
│    Support Closing   │  Senior Product Manager · Acme Corp       │
│    /closing          │  alex@company.com · (555) 123-4567        │
│    Thanks for reach… │                                           │
│                      │  Tags:  work   email   + Add tag          │
│    Meeting Request   │                                           │
│    /meet             │  [Copy to clipboard]  [Delete snippet]    │
│    I'd like to sche… │                                           │
│                      │  47 uses · Updated 2 days ago  [Save]     │
│    Bug Report        │                                           │
│    /bug              │                                           │
│    Steps to reprod…  │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

- **Left pane** — your full snippet list with live search. Each item shows the label, shortcut, and a content preview.
- **Right pane** — the full snippet editor. Edit content, manage tags, see usage stats.
- **Search** — type anything to filter by name, shortcut, or content in real time.

---

## Step 4 — The Snippet Editor & Slash Commands

The content editor supports **rich text** — not just plain text. Use the floating toolbar when you select text:

```
  Selected text → toolbar appears:

  ┌─────────────────────────────────────┐
  │  B  I  U  S  ⌘E  [⌘K]  [🖼]  [GIF] │
  └─────────────────────────────────────┘
  Bold · Italic · Underline · Strike · Code · Link · Image · GIF
```

### Slash Commands — Type `/` to open the command menu

Type `/` anywhere in the content editor to open the command palette:

```
  ┌────────────────────────────────────────────┐
  │  COMMANDS                                  │
  ├────────────────────────────────────────────┤
  │  [📋] Clipboard                            │
  │        Insert clipboard content placeholder│
  │                                            │
  │  [📅] Today                                │
  │        Insert today's date (click to       │
  │        change format)                      │
  │                                            │
  │  [↖]  Place Cursor                        │
  │        Set cursor position after insertion │
  │                                            │
  │  [📆] Pick Date                            │
  │        Choose any date from calendar       │
  │                                            │
  │  [🖼] Image                                │
  │        Insert an image from your device    │
  │                                            │
  │  [🎬] GIF                                  │
  │        Search and insert a GIF from Giphy  │
  └────────────────────────────────────────────┘
```

Type after the `/` to filter — for example, `/cl` narrows to **Clipboard**. Navigate with arrow keys, confirm with Enter, dismiss with Escape.

---

## Step 5 — Dynamic Placeholders

Make snippets that fill themselves in at expansion time. Instead of static text, use placeholders that resolve the moment the shortcut is triggered.

### Available placeholders

| Placeholder | Inserts at expansion |
|---|---|
| `{{clipboard}}` | Whatever is currently in your clipboard |
| `{{date:iso}}` | Today in `2026-03-14` format |
| `{{date:us}}` | Today in `03/14/2026` format |
| `{{date:eu}}` | Today in `14/03/2026` format |
| `{{date:long}}` | `March 14, 2026` |
| `{{date:short}}` | `Mar 14, 26` |
| `{{datepicker:YYYY-MM-DD}}` | A specific date you pick |
| `{{cursor}}` | Where your cursor lands after expansion |

> All placeholders are inserted from the **/** command menu — you don't need to type them by hand.

### Realistic example — a support reply with placeholders

**Snippet content in the editor:**

```
Hi {{clipboard}},

Thank you for contacting us on {{date:long}}.

We're looking into this and will follow up within 24 hours.{{cursor}}

Best,
The Support Team
```

**What gets inserted when you trigger the shortcut:**

- `{{clipboard}}` → the customer's name you copied before triggering
- `{{date:long}}` → `March 14, 2026`
- `{{cursor}}` → cursor lands here so you can add a personal note before sending

---

## Step 6 — Images in Snippets

Clipio lets you embed images directly in your snippet content — stored locally in your browser, no external server involved.

### Inserting an image in the editor

Type `/` to open the command menu and select **Image**. A floating picker opens:

```
  ┌──────────────────────────────────┐
  │  🔍 Search images...          ╳  │
  ├──────────────────────────────────┤
  │  ┌──────────┐  ┌──────────────┐  │
  │  │    +     │  │  [thumbnail] │  │
  │  │  Upload  │  │  logo.png    │  │
  │  │  new img │  └──────────────┘  │
  │  └──────────┘                    │
  │  ┌──────────────┐  ┌──────────┐  │
  │  │  [thumbnail] │  │[thumb]   │  │
  │  │  screenshot  │  │banner    │  │
  │  └──────────────┘  └──────────┘  │
  └──────────────────────────────────┘
```

- **Upload cell (top-left)** — always there. Click to open a file browser, or drag and drop an image onto the panel.
- **Stored images** — every image you've ever uploaded appears here. Click one to insert it without re-uploading.
- **Search** — filter stored images by their description (alt text).

> Supported formats: JPEG, PNG, WebP, GIF. Images are stored in your browser's IndexedDB — they never leave your device.

### Managing Images — the Images tab in Settings

Open **Settings (⚙)** and go to **Images** in the left sidebar to manage all stored images:

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Preferences                                                 │
  │  ─────────────────────                                       │
  │  General                │  Images                           │
  │  Import & Export        │  Manage all images stored in      │
  │  Appearance             │  your snippets.                   │
  │  ▶ Images               │                                   │
  │  Developers             │  Total image storage              │
  │  Feedback               │  ████████░░░░  42 KB / 512 KB    │
  │                         │                                   │
  │                         │  [List view]  [Grid view]         │
  │                         │  ──────────────────────────────── │
  │                         │  [🖼] 1920 × 1080       [Delete] │
  │                         │      Description: Company logo    │
  │                         │      Used in: Email Signature,    │
  │                         │      Support Template             │
  │                         │                                   │
  │                         │  [🖼] 800 × 600          [Delete] │
  │                         │      Description: Add a           │
  │                         │      description (used as         │
  │                         │      alt text)                    │
  │                         │      Not used in any snippets     │
  └──────────────────────────────────────────────────────────────┘
```

From here you can:
- **See your total image storage** with a progress bar (turns amber as you approach the limit)
- **Edit the description** of any image (used as alt text for accessibility)
- **See which snippets reference each image** — so you know what breaks if you delete one
- **Delete images** — a confirmation dialog warns you if deleting will break existing snippets
- **Switch between list and grid view**

> If you delete an image that's referenced by a snippet, that snippet will show a broken image placeholder until you re-upload or remove the reference.

---

## Step 7 — Animated GIFs

Insert GIFs from Giphy directly into your snippets. Type `/` → select **GIF** to open the GIF picker:

```
  ┌───────────────────────────────────┐
  │  🔍 Search GIFs...             ╳  │
  ├───────────────────────────────────┤
  │  Trending                         │
  │  ┌───────┐ ┌───────┐ ┌───────┐   │
  │  │ [gif] │ │ [gif] │ │ [gif] │   │
  │  └───────┘ └───────┘ └───────┘   │
  │  ┌───────┐ ┌───────┐ ┌───────┐   │
  │  │ [gif] │ │ [gif] │ │ [gif] │   │
  │  └───────┘ └───────┘ └───────┘   │
  │  [Load more]                      │
  │  ───────────────────────────────  │
  │  Powered by GIPHY                 │
  └───────────────────────────────────┘
```

- Browse **trending GIFs** or type to search
- Click any GIF to insert it into the snippet
- GIFs are stored as lightweight Giphy references — no blobs saved to your browser

> Bring your own Giphy API key in **Settings → Developers → Giphy API Key** to use your own rate limits.

---

## Step 8 — Import from Other Tools

Already have a snippet library elsewhere? Import it in seconds — no manual re-entry needed.

Go to **Settings → Import & Export → Import snippets** and drop your export file. Clipio auto-detects the format:

| Tool | What gets converted automatically |
|---|---|
| **TextBlaze** | Folders become tags. `{cursor}` → `{{cursor}}`. `{clipboard}` → `{{clipboard}}`. HTML snippets → Markdown. |
| **Power Text** | `%clip%` / `%clipboard%` → `{{clipboard}}`. `%d(YYYY-MM-DD)` and other date formats → matching `{{date:*}}` placeholders. |
| **Clipio** | Full round-trip support for both current and legacy export files. |

The **import wizard** walks you through three steps:

```
  ① Upload → ② Placeholders → ③ Conflicts → ④ Confirm

  ① Upload
  ┌──────────────────────────────────────────────────┐
  │                                                  │
  │       Drop a JSON or ZIP file here               │
  │              or click to browse                  │
  │                                                  │
  │       Detected format: TextBlaze        ✓        │
  │       Found 47 snippets                          │
  │                                                  │
  └──────────────────────────────────────────────────┘
                                        [Cancel] [Next →]

  ② Placeholders (if any unsupported ones found)
     Shows unrecognised placeholders with options:
     · Keep as literal text
     · Remove from content
     · Skip this snippet

  ③ Conflicts (if any shortcuts already exist)
     · Skip (don't import)
     · Overwrite existing
     · Import with new shortcut

  ④ Confirm — preview counts, storage estimate, then import
```

---

## Step 9 — Sync Across Devices

Clipio syncs your snippet library across all your browsers using your browser's built-in sync account — the same mechanism that syncs bookmarks and extensions settings.

Install Clipio on your work machine and your laptop. Your snippets are available on both within seconds.

### Automatic storage fallback

Browser sync storage has a limit (~100 KB). If your library grows beyond that, Clipio automatically and transparently switches to local storage — no data is lost, no interruption to your workflow. A banner in the popup notifies you:

```
  ┌──────────────────────────────────────────────────────────────┐
  │  ⚠  Sync storage full — snippets saved locally only.        │
  │     Export backup →                                          │
  └──────────────────────────────────────────────────────────────┘
```

A **shadow backup** is also continuously written to your browser's IndexedDB. If anything ever goes wrong with sync, you can recover your entire library from this backup via **Settings → Developers → Clear IDB Backup / Try Recover**.

---

## Step 10 — Right-Click Menu

Clipio adds a context menu to every page so you can create and manage snippets without opening the popup:

```
  Right-click on any page:

  ├── Save selection as snippet   ← select text first, then right-click
  ├── Create new snippet
  ├── Open Clipio
  ├── Give feedback
  └── Hide on this site           ← disables expansion on this domain
```

**"Save selection as snippet"** is the fastest way to create a snippet from existing text — select the text on any page, right-click, and choose this option. The snippet form opens pre-filled with the selected text as the content.

**"Hide on this site"** adds the current domain to a block list. Expansion is silently disabled on blocked sites — useful for sites where the shortcut characters conflict with built-in shortcuts.

---

## Step 11 — Appearance

Go to **Settings → Appearance** to customize Clipio:

- **Theme** — Light, Dark, or follow your System preference
- **Confetti on insert** — a small confetti burst fires every time a snippet expands. Satisfying. Toggle it off if you prefer a quieter experience.

---

## Step 12 — Developers & Power-User Settings

**Settings → Developers** exposes advanced tools for users who want full control. It's marked experimental — settings here are for troubleshooting and power use.

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Developers                                                  │
  │  Advanced settings for power users and developers.          │
  │  ⚠ Experimental — changes here may break your setup.        │
  ├──────────────────────────────────────────────────────────────┤
  │  Extension Version & Update                                  │
  │  Version: 1.4.2                              ✓ Up to date   │
  ├──────────────────────────────────────────────────────────────┤
  │  Content Script Health                                       │
  │  Ping the active tab's content script.                       │
  │  [Ping content script]  →  Pong — content script is active  │
  ├──────────────────────────────────────────────────────────────┤
  │  Storage Mode & Quota                                        │
  │  Active backend: sync                                        │
  │  Sync used: 12,480 / 102,400 bytes                           │
  │                                       [Switch to local]     │
  ├──────────────────────────────────────────────────────────────┤
  │  Typing Timeout                                              │
  │  How long Clipio waits after you stop typing.                │
  │  50ms ──────●────────────────── 2000ms        300 ms        │
  │                                       [Reset to default]    │
  ├──────────────────────────────────────────────────────────────┤
  │  Top 5 Usage                                                 │
  │  Email Signature     /sig         47 uses                    │
  │  Support Closing     /closing     23 uses                    │
  │  Meeting Request     /meet        18 uses                    │
  │  Bug Report          /bug         11 uses                    │
  │  OOO Reply           /ooo          9 uses                    │
  ├──────────────────────────────────────────────────────────────┤
  │  Giphy API Key                                               │
  │  [Enter your Giphy API key...]               [Reset]        │
  ├──────────────────────────────────────────────────────────────┤
  │  Debug Mode                                                  │
  │  Logs extension activity to this panel.                      │
  │  [ ] Enable debug logging                                    │
  ├──────────────────────────────────────────────────────────────┤
  │  Clear IDB Backup                                            │
  │  Wipe the IndexedDB snippets backup store.                   │
  │  [Clear backup]                                              │
  └──────────────────────────────────────────────────────────────┘
```

| Card | What it does |
|---|---|
| **Extension Version & Update** | Shows installed version. If an update is available, shows a link to the GitHub release. |
| **Content Script Health** | Sends a ping to the active tab's content script and shows the response. Use this to verify the extension is loaded and working on the current page. |
| **Storage Mode & Quota** | Shows active backend (sync or local), byte usage vs. the 100 KB limit, and two-step buttons to manually force-switch backends (migrates all snippets in the process). |
| **Typing Timeout** | Slider (50–2000 ms, default 300 ms) for how long Clipio waits after you stop typing before attempting expansion. Lower = faster, but may expand in the middle of words on slow connections. Takes effect without page reload. |
| **Top 5 Usage** | Your five most-expanded snippets by insertion count. |
| **Giphy API Key** | Override the bundled default key with your own for higher rate limits. |
| **Debug Mode** | Enables verbose logging to a live in-page log panel. Each entry shows timestamp, source (content / background / storage), event name, and detail. Includes a Copy log button for sharing with support. |
| **Clear IDB Backup** | Wipes the IndexedDB backup store. Requires two-step confirmation. |

---

## Browser Support

| Browser | Status |
|---|---|
| Chrome | Supported |
| Edge, Brave, Arc, and other Chromium-based browsers | Supported |
| Firefox | Supported |

---

## Privacy

- All snippets are stored **in your browser** — nothing is ever sent to an external server.
- Images are stored in your browser's **IndexedDB** and never leave your device.
- GIFs are stored as **Giphy links only** — no image data is saved locally.
- Error reporting (Sentry) is optional and **scrubs any personally identifiable information** before sending — no snippet content, no URLs, no email addresses reach the error tracker.
- Usage counts and debug logs are stored **locally only** and never transmitted.
