import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MemoryGraph } from "../../api/client";
import { isImeKeyboardEvent } from "../../utils/imeKey";

/**
 * Simple deterministic force-directed graph layout.
 *
 * Runs a fixed number of iterations on mount/prop change and returns final
 * node positions. Deterministic (no animation) so it is stable across re-renders.
 */
function useForceLayout(
  nodes: MemoryGraph["nodes"],
  edges: MemoryGraph["edges"],
  width: number,
  height: number,
) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (nodes.length === 0) return;

    // Initialize positions in a circle
    const pos: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;

    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      pos[node.id] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    // Simple force simulation
    const iterations = 50;
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos[nodes[i].id];
          const b = pos[nodes[j].id];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 5000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = pos[edge.source];
        const b = pos[edge.target];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.01 * edge.weight;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Apply velocities with damping
      for (const node of nodes) {
        const p = pos[node.id];
        p.vx *= 0.9;
        p.vy *= 0.9;
        p.x += p.vx;
        p.y += p.vy;
        // Keep within bounds
        p.x = Math.max(50, Math.min(width - 50, p.x));
        p.y = Math.max(50, Math.min(height - 50, p.y));
      }
    }

    // Extract final positions
    const finalPos: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) {
      finalPos[node.id] = { x: pos[node.id].x, y: pos[node.id].y };
    }
    setPositions(finalPos);
  }, [nodes, edges, width, height]);

  return positions;
}

function escapeAttr(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 沿着图谱给出的顺序移动。到头就停住，不绕回另一头。 */
function nextGraphIndex(index: number, count: number, key: string): number | null {
  if (index < 0 || count === 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "ArrowUp" || key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

const CATEGORY_COLORS: Record<string, string> = {
  fact: "#10b981", // success — 关于你的事实（已验证）
  preference: "#6366f1", // insight — 偏好（AI 洞察）
  event: "#f59e0b", // warning — 经历过的事件（需要回忆）
  goal: "#6366f1", // insight — 目标（AI 追踪）
};

export default function MemoryGraphView({ graph }: { graph: MemoryGraph }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const width = 700;
  const height = 500;

  const positions = useForceLayout(graph.nodes, graph.edges, width, height);
  const tabTarget =
    tabId && graph.nodes.some((node) => node.id === tabId) ? tabId : (graph.nodes[0]?.id ?? null);

  const focusNode = (id: string) => {
    setTabId(id);
    svgRef.current?.querySelector<SVGGElement>(`[data-memory-node="${escapeAttr(id)}"]`)?.focus();
  };

  const onNodeKeyDown = (nodeId: string) => (event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // 组字或输入法处理键时不移动，也不拦住这一下。
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      return;
    }
    const index = graph.nodes.findIndex((node) => node.id === nodeId);
    const next = nextGraphIndex(index, graph.nodes.length, event.key);
    if (next == null) return;
    event.preventDefault();
    const target = graph.nodes[next];
    if (!target || target.id === nodeId) return;
    focusNode(target.id);
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="group"
        aria-label="记忆图谱"
        className="mx-auto"
        style={{ background: "#111827" }}
      >
        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const source = positions[edge.source];
          const target = positions[edge.target];
          if (!source || !target) return null;
          const isHighlighted =
            hoveredNode === edge.source ||
            hoveredNode === edge.target ||
            focusedNode === edge.source ||
            focusedNode === edge.target;
          return (
            <line
              key={i}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={isHighlighted ? "#818cf8" : "#374151"}
              strokeWidth={isHighlighted ? 2 : 1}
              strokeOpacity={isHighlighted ? 0.8 : 0.3}
            />
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const color = CATEGORY_COLORS[node.category] || "#6b7280";
          const isHovered = hoveredNode === node.id;
          const isFocused = focusedNode === node.id;
          const revealed = isHovered || isFocused;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={node.id === tabTarget ? 0 : -1}
              data-memory-node={node.id}
              aria-label={node.content}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onFocus={() => {
                setFocusedNode(node.id);
                setTabId(node.id);
              }}
              onBlur={() => setFocusedNode((current) => (current === node.id ? null : current))}
              onKeyDown={onNodeKeyDown(node.id)}
              // 组的外框会画成大方块。焦点环画在圆点上，颜色与时间线相同。
              className="cursor-pointer focus-visible:outline-none"
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={revealed ? 12 : 8}
                fill={color}
                stroke={isFocused ? "var(--color-focus-ring)" : isHovered ? "#f3f4f6" : "none"}
                strokeWidth={2}
              />
              {revealed && (
                <text
                  x={pos.x}
                  y={pos.y - 20}
                  textAnchor="middle"
                  fill="#f3f4f6"
                  fontSize={11}
                  className="pointer-events-none"
                >
                  {node.content.slice(0, 30)}
                  {node.content.length > 30 ? "..." : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute top-4 right-4 bg-surface-overlay/80 rounded-lg p-3 text-xs">
        <div className="font-medium text-fg-primary mb-2">类别</div>
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-2 text-fg-secondary">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            {cat}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute bottom-4 left-4 text-xs text-fg-tertiary">
        {graph.nodes.length} 个记忆 · {graph.edges.length} 条关联
      </div>
    </div>
  );
}
