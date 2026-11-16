# NodeTrain

An infinite visual workspace for building, connecting and automating AI workflows.

It is a local app: a web canvas plus a small server on your own computer that keeps your workflows, images and run history in a `data/` folder. **No AI model is called yet.** Pressing Run produces a *simulated* preview, stamped as such, until the OpenAI provider arrives in step 3.

## Run it locally (Windows, macOS or Linux)

You need [Node.js](https://nodejs.org) 22.13 or newer (it includes the SQLite database NodeTrain uses, so there is nothing else to install).

```bash
git clone https://github.com/christian-jaimes/nodetrain.git
cd nodetrain
npm install
npm run dev
```

Then open http://localhost:5173. `npm run dev` starts both the app and the local server (on port 8787, reachable only from your own machine).

To run it without the dev tools, use `npm start` and open http://localhost:8787.

Your data lives in `data/` next to the code: `nodetrain.db` (boards, every saved revision, run history) and `artifacts/` (every image, stored once by content). Back that folder up to keep your work. Set `NODETRAIN_DATA_DIR` to keep it somewhere else. If you used the step 1 prototype in this browser, its board is imported automatically the first time.

## What works

- **Start screen** with *Blank workflow* or *Browse templates* (Product photography, Storyboard starter, Character exploration).
- **Infinite canvas**: pan by dragging or scrolling, pinch or Ctrl+scroll to zoom, box-select with Shift+drag.
- **Three MVP nodes**: Prompt, Image Input and Image Generation.
- **Typed ports**: text ports are purple diamonds and image ports are red circles, each with a label and a tooltip. Incompatible connections and loops are refused, with a message saying why.
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
  providers/    Model provider boundary. `simulated.ts` today, OpenAI in step 3
src/            The app (React + React Flow)
  store/        Board state: undo history, autosave, run polling
  components/   Canvas, nodes, sidebar, inspector, overlays
tests/          `npm test`: graph rules, document migration, server API and runs
docs/           Product requirements and visual references
```

## Roadmap

1. ~~Canvas prototype~~
2. **Graph engine and local backend** (this)
3. The real image workflow on OpenAI, with run history, stale outputs, selective reruns and export
4. Polish, accessibility pass, cost readout, then choose the next phase
