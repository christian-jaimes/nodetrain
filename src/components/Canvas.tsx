import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeTypes,
} from '@xyflow/react';
import { useEffect, useMemo, type DragEvent, type MouseEvent } from 'react';
import { getPort } from '../../shared/graph/catalog';
import { FIT_OPTIONS } from '../lib/ui';
import type { AppEdge, AppNode, NodeKind } from '../../shared/graph/types';
import { checkConnection } from '../../shared/graph/validate';
import { useBoard } from '../store/board';
import { ImageGenerationNode } from './nodes/ImageGenerationNode';
import { ImageInputNode } from './nodes/ImageInputNode';
import { PromptNode } from './nodes/PromptNode';

const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  imageGeneration: ImageGenerationNode,
};

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
      return { ...e, className: `edge--${type ?? 'unknown'}`, animated: running } as Edge;
    });
  }, [nodes, rawEdges]);

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
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStart={() => commit()}
        onSelectionDragStart={() => commit()}
        forceColorMode="dark"
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        panOnScroll
        zoomOnPinch
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT_OPTIONS}
        attributionPosition="bottom-center"
        connectionRadius={28}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#2c2c33" />
      </ReactFlow>
    </div>
  );
}
