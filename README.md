# NodeTrain

An infinite visual workspace for building, connecting and automating AI workflows.

This is **step 1 of the build plan: a clickable canvas prototype.** It runs entirely in your browser. No AI model is called yet: pressing Run produces a *simulated* preview (labelled as such) so the canvas, connections and run states can be judged before we wire up OpenAI in step 3.

## Run it locally (Windows, macOS or Linux)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/christian-jaimes/nodetrain.git
cd nodetrain
npm install
npm run dev
```

Then open http://localhost:5173.

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
- **Autosave** to the browser (IndexedDB) with a Saved / Saving / Not saved indicator. Your board survives a refresh.
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
src/
  graph/        Pure workflow logic: node catalog, port types, validation, run planning, templates
  store/        Board state (zustand): history, autosave, simulated runs
  components/   Canvas, nodes, sidebar, inspector, overlays
  lib/images.ts Image import/downscale and the simulated generator
docs/           Product requirements and visual references
```

## Roadmap

1. **Canvas prototype** (this)
2. Graph engine and local backend: versioned schemas, SQLite run history, image files on disk, OpenAI key kept server-side
3. The real image workflow on OpenAI, with run history, stale outputs, selective reruns and export
4. Polish, accessibility pass, cost readout, then choose the next phase
