import {
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type IsValidConnection,
  type EdgeTypes,
  type NodeTypes,
  SelectionMode,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { getPort } from '../../shared/graph/catalog';
import { FIT_OPTIONS, NODE_WIDTH } from '../lib/ui';
import type { AppEdge, AppNode, NodeKind } from '../../shared/graph/types';
import { checkConnection, planDrop } from '../../shared/graph/validate';
import { useBoard } from '../store/board';
import { Groups } from './Groups';
import { LinkEdge } from './LinkEdge';
import { ImageGenerationNode } from './nodes/ImageGenerationNode';
import { ImageInputNode } from './nodes/ImageInputNode';
import { PromptNode } from './nodes/PromptNode';

const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  imageGeneration: ImageGenerationNode,
};

const edgeTypes: EdgeTypes = { link: LinkEdge };

const FALLBACK = { w: NODE_WIDTH, h: 160 };
const GAP = 80;
type Box = { x: number; y: number; w: number; h: number };

const boxOf = (n: AppNode): Box => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? FALLBACK.w, h: n.measured?.height ?? n.height ?? FALLBACK.h });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The node under the middle of the dragged node, if any. Groups are not nodes, so dropping onto a group's container never matches. */
function nodeUnder(nodes: AppNode[], dragged: AppNode): AppNode | undefined {
  const d = boxOf(dragged);
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  return nodes.find((n) => {
    if (n.id === dragged.id) return false;
    const b = boxOf(n);
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  });
}

export const DRAG_MIME = 'application/x-nodetrain-node';

export function Canvas() {
  const nodes = useBoard((s) => s.nodes);
  const rawEdges = useBoard((s) => s.edges);
  const onNodesChange = useBoard((s) => s.onNodesChange);
  const onEdgesChange = useBoard((s) => s.onEdgesChange);
  const connect = useBoard((s) => s.connect);
  const commit = useBoard((s) => s.commit);
  const notify = useBoard((s) => s.notify);
  const addNode = useBoard((s) => s.addNode);
  const setPicker = useBoard((s) => s.setPicker);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const draggedRef = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; ok: boolean } | null>(null);
  const setNodePosition = useBoard((s) => s.setNodePosition);
  const tool = useBoard((s) => s.tool);
  const fitNonce = useBoard((s) => s.fitNonce);
  const measured = useNodesInitialized();

  useEffect(() => {
    if (fitNonce && measured) void fitView(FIT_OPTIONS);
  }, [fitNonce, measured, fitView]);

  // Colour and animate edges by the data type they carry and run state.
  const edges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return rawEdges.map((e) => {
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      const type = src ? getPort(src.type as NodeKind, 'source', e.sourceHandle)?.type : undefined;
      const running = tgt?.type === 'imageGeneration' && tgt.data.status === 'running';
      const into = tgt ? getPort(tgt.type as NodeKind, 'target', e.targetHandle)?.label : undefined;
      // Screen readers announce edges; name them by node titles rather than ids.
      const ariaLabel = `Connection from ${src?.data.title ?? 'a node'} to ${tgt?.data.title ?? 'a node'}${into ? `, ${into}` : ''}`;
      return { ...e, type: 'link', className: `edge--${type ?? 'unknown'}`, animated: running, ariaLabel } as Edge;
    });
  }, [nodes, rawEdges]);

  // Highlight the node a dragged node would connect to: green when the link works, red when it would be refused.
  const shownNodes = useMemo(
    () => (dropTarget ? nodes.map((n) => (n.id === dropTarget.id ? { ...n, className: dropTarget.ok ? 'drop-ok' : 'drop-bad' } : n)) : nodes),
    [nodes, dropTarget],
  );

  const onNodeDrag = (_: unknown, node: AppNode, dragged: AppNode[]) => {
    if (dragged.length !== 1) return setDropTarget(null);
    const s = useBoard.getState();
    const target = nodeUnder(s.nodes, node);
    if (!target) return setDropTarget((t) => (t ? null : t));
    const ok = planDrop(s.nodes, s.edges, node.id, target.id).ok;
    setDropTarget((t) => (t?.id === target.id && t.ok === ok ? t : { id: target.id, ok }));
  };

  /** Dropping node 1 on node 2 links 1's output to 2's input. Node 1 then leaves, so it doesn't sit on top of node 2. */
  const onNodeDragStop = (_: unknown, node: AppNode, dragged: AppNode[]) => {
    setTimeout(() => (draggedRef.current = false), 0);
    setDropTarget(null);
    const start = dragStart.current;
    dragStart.current = null;
    if (dragged.length !== 1) return;
    const s = useBoard.getState();
    const target = nodeUnder(s.nodes, node);
    if (!target) return;
    const plan = planDrop(s.nodes, s.edges, node.id, target.id);
    // Back to where it came from; if that was also on top of the target, to the left of it instead.
    const me = boxOf(node);
    const tb = boxOf(target);
    const home = start && !overlaps({ ...me, ...start }, tb) ? start : { x: tb.x - me.w - GAP, y: tb.y };
    setNodePosition(node.id, home);
    if (!plan.ok) return notify(plan.reason, 'error');
    const r = connect(plan.connection);
    if (!r.ok) notify(r.reason, 'error');
  };

  const isValidConnection: IsValidConnection<AppEdge> = (c) => {
    const s = useBoard.getState();
    return checkConnection(s.nodes, s.edges, c).ok;
  };

  const onConnect = (c: Connection) => {
    const r = connect(c);
    if (!r.ok) notify(r.reason, 'error');
  };

  const onConnectEnd = (event: globalThis.MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromHandle || !state.fromNode) return;
    if (state.toHandle && state.toNode) {
      // Released on a port that refused the connection: say why.
      const s = useBoard.getState();
      const from = state.fromHandle;
      const to = state.toHandle;
      const c =
        from.type === 'source'
          ? { source: from.nodeId, sourceHandle: from.id, target: to.nodeId, targetHandle: to.id }
          : { source: to.nodeId, sourceHandle: to.id, target: from.nodeId, targetHandle: from.id };
      const r = checkConnection(s.nodes, s.edges, c);
      if (!r.ok) notify(r.reason, 'error');
      return;
    }
    if (state.toNode) return;
    // Released on empty canvas: offer to create a connected node.
    const p = 'changedTouches' in event ? event.changedTouches[0] : event;
    setPicker({
      screen: { x: p.clientX, y: p.clientY },
      flow: screenToFlowPosition({ x: p.clientX, y: p.clientY }),
      from: { nodeId: state.fromNode.id, handleId: state.fromHandle.id ?? '', handleType: state.fromHandle.type },
    });
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
    setPicker({ screen: { x: e.clientX, y: e.clientY }, flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
  };

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_MIME) as NodeKind;
    if (!kind) return;
    e.preventDefault();
    addNode(kind, screenToFlowPosition({ x: e.clientX - 60, y: e.clientY - 24 }));
  };

  return (
    <div className="canvas" onDoubleClick={onDoubleClick} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<AppNode, AppEdge>
        nodes={shownNodes}
        edges={edges}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onPaneClick={() => useBoard.getState().setHistoryOpen(false)}
        onNodeDragStart={(_, node) => {
          draggedRef.current = true;
          dragStart.current = { ...node.position };
          commit();
        }}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        // Dragging any node of a selected group moves them all, but a plain click picks just that node.
        onNodeClick={(e, node) => {
          if (draggedRef.current || e.shiftKey || e.metaKey || e.ctrlKey) return;
          const s = useBoard.getState();
          if (s.nodes.filter((n) => n.selected).length > 1) s.selectNodes([node.id]);
        }}
        onSelectionDragStart={() => commit()}
        forceColorMode="dark"
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        panOnScroll
        // Move: dragging empty canvas pans. Select: it draws a box that selects every node it fully contains, and the middle or right button pans.
        panOnDrag={tool === 'move' ? true : [1, 2]}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Full}
        zoomOnPinch
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT_OPTIONS}
        proOptions={{ hideAttribution: true }}
        connectionRadius={28}
      >
        <Groups />
      </ReactFlow>
    </div>
  );
}
