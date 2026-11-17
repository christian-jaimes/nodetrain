# NodeTrain

An infinite visual workspace for building, connecting and automating AI workflows.

It is a local app: a web canvas plus a small server on your own computer that keeps your workflows, images and run history in a `data/` folder. Image Generation nodes call OpenAI with your own API key. Without a key, Run produces a *simulated* preview, stamped as such, so you can try everything for free.

## Run it locally (Windows, macOS or Linux)

You need [Node.js](https://nodejs.org) 22.13 or newer (it includes the SQLite database NodeTrain uses, so there is nothing else to install).

```bash
git clone https://github.com/christian-jaimes/nodetrain.git
cd nodetrain
npm install
npm run dev
```

Then open http://localhost:5173. `npm run dev` starts both the app and the local server (on port 8787, reachable only from your own machine).

If the app says it **can't reach the NodeTrain server**, look at the terminal running `npm run dev`: the line starting with `[server]` says what went wrong. The most common causes are a Node.js older than 22.13 (`node -v` to check), a missing `npm install`, or another NodeTrain still running on port 8787.

To run it without the dev tools, use `npm start` and open http://localhost:8787.

Your data lives in `data/` next to the code: `nodetrain.db` (boards, every saved revision, run history) and `artifacts/` (every image, stored once by content). Back that folder up to keep your work. Set `NODETRAIN_DATA_DIR` to keep it somewhere else. If you used the step 1 prototype in this browser, its board is imported automatically the first time.

## Connect OpenAI

1. Create an API key at https://platform.openai.com/api-keys. Image models may require a verified organization on your OpenAI account.
2. With `npm run dev` running, open **Account settings** at the bottom of the left sidebar (or click the **Simulated** badge in the title bar).
3. Paste the key and press **Save key**. NodeTrain checks it with OpenAI, and the badge turns green: **OpenAI**. No restart needed.

Prefer a file? Copy `.env.example` to `.env`, set `OPENAI_API_KEY=`, and restart `npm run dev`. A key saved in Account settings takes priority over `.env`; remove it there to fall back.

The key stays on your computer. A key saved in the app is stored in `data/secrets.json`; only the local server reads it, it is never sent back to the browser (the app only sees a hint like `sk-…abcd`) or saved in a board, and both `data/` and `.env` are ignored by git so they can't be committed. The server only accepts requests from this computer's own pages. **Every run is billed to your OpenAI account.** Each run's tokens and estimated cost appear in the Activity tab, and the workflow overview shows the estimated spend for this workflow and for today across all workflows. Estimates use OpenAI's published standard prices (checked 2026-11-16) and ignore cache discounts. Your [OpenAI usage page](https://platform.openai.com/usage) has the exact bill. Set `NODETRAIN_PROVIDER=simulated` in `.env` to go back to free simulated previews without removing the key.

| Model | Aspect ratios | Quality | Price per 1M tokens (text in / image in / image out) |
| --- | --- | --- | --- |
| gpt-image-2.6-flare (default), gpt-image-2.6-sunburst | Default, 1:1, 3:2, 2:3 | Default, Low, Medium, High | $5 / $8 / $30 |
| gpt-image-2.5-flare, gpt-image-2.5-sunburst | Default, 1:1, 3:2, 2:3, 16:9 | adds Extra high and Max | $5 / $8 / $30 |
| gpt-image-2 (shuts down Feb 10, 2027) | Default, 1:1, 3:2, 2:3, 16:9 | Default, Low, Medium, High | $5 / $8 (assumed) / $30 |
| gpt-image-1.5 (shuts down Dec 1, 2026) | Default, 1:1, 3:2, 2:3 | Default, Low, Medium, High | $5 / $8 / $32 |
| gpt-image-1-mini (shuts down Dec 1, 2026) | Default, 1:1, 3:2, 2:3 | Default, Low, Medium, High | $2 / $2.50 / $8 |

Flare is OpenAI's fast everyday model and Sunburst is tuned for precise edits. OpenAI doesn't yet document custom sizes or the Extra high and Max qualities for 2.6, so use a 2.5 model for 16:9. Nodes on a model with an announced shutdown show a notice.

A prompt-only node uses OpenAI's image generation endpoint. A node with connected reference images uses the edit endpoint, with up to 16 references. Settings a model can't do are greyed out, and boards that used the retired gpt-image-1 are moved to gpt-image-2.6-flare. Failures are explained in plain words (bad key, out of quota, blocked by the content policy, OpenAI outage) with OpenAI's request id, and rate limits and outages are retried automatically.

## What works

- **Start screen** with *Blank workflow* or *Browse templates* (Product photography, Storyboard starter, Character exploration).
- **Infinite canvas**: pan by dragging or scrolling, pinch or Ctrl+scroll to zoom, box-select with Shift+drag.
- **Three MVP nodes**: Prompt, Image Input and Image Generation.
- **Typed ports**: both port types are circles, purple for text and red for images, each with a label and a tooltip. Incompatible connections and loops are refused, with a message saying why.
- **Drag out of a port onto empty canvas** to open a filtered "Create connected node" picker. The node and its connection are created together, and Escape cancels both.
- **Double-click the canvas** to add any node. You can also drag a node from the sidebar or click it there.
- **Inspector** for the selected node, showing the exact prompt that will be sent, the settings, the output, earlier versions and the run activity.
- **Run states**: Not run, Queued, Generating, Up to date, Failed, and **Out of date** once an input changes after a run. Each state has an icon and a label, so colour is never the only signal.
- **Undo/redo**, copy/paste and duplicate. Run results are kept out of undo, so undo never deletes an output.
- **Autosave** to the local server with a Saved / Saving / Not saved indicator. Each save is a new revision, and saving from an older tab is refused rather than overwriting.
- **Several workflows**: the Workflows tab lists your boards, and starting a template creates a new one.
- **Runs happen on the server.** A run uses one saved revision, so later edits never change what it did. Refreshing the page mid-run picks the run back up, and a run interrupted by stopping the server is marked as failed. Each node's run records the exact prompt, reference images, model and settings used.
- **Images are validated on the server** by decoding them. Files that are not real images are rejected whatever their name. Large images get a preview thumbnail.
- **Export** the workflow as JSON.

## Keyboard

| Action | Shortcut |
| --- | --- |
| Search nodes | Ctrl/⌘ + K |
| Run workflow | Ctrl/⌘ + Enter |
| Undo / Redo | Ctrl/⌘ + Z / Ctrl/⌘ + Shift + Z (or Ctrl + Y) |
| Copy / Paste / Duplicate | Ctrl/⌘ + C / V / D |
| Delete selection | Delete or Backspace |
| Fit workflow | Shift + 1 |
| Deselect | Esc |

## Accessibility

- Everything is reachable by keyboard in reading order: sidebar, title, canvas (connections, then nodes and their fields), then the Inspector.
- Focus is always visible, ports and connections have spoken names ("Connection from Background to Image generation, References"), and run states use an icon and a label, never colour alone.
- Text and buttons meet WCAG AA contrast, and animations stop when the system asks for reduced motion.
- Checked with axe-core on the start screen, templates, board, selected node and Activity tab: no violations.

## Project layout

```
shared/         Used by both app and server
  graph/        Node catalog, port types, validation, run planning, board document format and migrations
  api.ts        Request and response shapes
server/         Local server (Hono + Node's built-in SQLite + sharp)
  app.ts        HTTP routes
  db.ts         Schema and migrations
  artifacts.ts  Image validation, storage and thumbnails
  runs.ts       Run orchestrator: snapshots, ordering, status, cancel, recovery
  providers/    Model provider boundary. `openai.ts` and `simulated.ts`
src/            The app (React + React Flow)
  store/        Board state: undo history, autosave, run polling
  components/   Canvas, nodes, sidebar, inspector, overlays
tests/          `npm test`: graph rules, document migration, server API, runs and the OpenAI adapter (mocked, no key needed)
docs/           Product requirements and visual references
```

## Roadmap

1. ~~Canvas prototype~~
2. ~~Graph engine and local backend~~
3. ~~The real image workflow on OpenAI~~
4. **Polish, accessibility pass and cost readout** (this), then choose the next phase
