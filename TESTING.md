# Testing Snippet Auto-Expansion

## How to Test:

1. **Build and load the extension:**

   ```bash
   pnpm build
   ```

   - Load the `dist` folder in Chrome: chrome://extensions/ → "Load unpacked"

2. **Login to the extension:**
   - Click the extension icon
   - Login with your cloud credentials
   - Make sure you have snippets with shortcuts like `!forEach`, `!map`, etc.

3. **Test on any webpage:**
   - Go to any website (gmail.com, github.com, etc.)
   - Click on any input field or textarea
   - Type a snippet shortcut (e.g., `!forEach`)
   - Press **Space** or **Tab**, or wait 750ms
   - The shortcut should expand to the full snippet content!

## Debug Console:

Open the browser console (F12) to see debug messages:

- `[Clipio] Content script initializing...` - Script loaded
- `[Clipio] Loaded X snippets: [shortcuts]` - Snippets loaded successfully
- `[Clipio] Expanding: shortcut -> title` - When expansion happens

## Common Issues:

1. **"No user info or token found"** - Not logged in to the extension
2. **"Loaded 0 snippets"** - No snippets created yet
3. **No expansion happening** - Check that the shortcut exactly matches (case-sensitive)

## Quick Test HTML:

Create a simple test.html file:

```html
<!DOCTYPE html>
<html>
  <body>
    <h1>Test Snippet Expansion</h1>
    <p>Type your snippet shortcut and press Space or Tab:</p>
    <textarea rows="10" cols="50" placeholder="Type here..."></textarea>
    <br /><br />
    <input
      type="text"
      placeholder="Or type in input..."
      style="width: 400px; padding: 10px;"
    />
  </body>
</html>
```

Open this file in Chrome and test the expansion!
