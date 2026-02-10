/**
 * Brain 状态机可视化组件
 *
 * 从 API 获取图结构数据动态渲染，确保与服务端状态机定义始终同步。
 * 通过 currentState 高亮当前节点。
 */

import type { BrainGraphData, BrainGraphNode } from '@/types/api'

const NODE_WIDTH = 100
const NODE_HEIGHT = 38
const NODE_RX = 8
const SVG_WIDTH = 650
const SVG_HEIGHT = 240

function getNodeCenter(node: BrainGraphNode): { cx: number; cy: number } {
    return { cx: node.x + NODE_WIDTH / 2, cy: node.y + NODE_HEIGHT / 2 }
}

function getEdgePoints(
    fromNode: BrainGraphNode,
    toNode: BrainGraphNode
): { x1: number; y1: number; x2: number; y2: number } {
    const a = getNodeCenter(fromNode)
    const b = getNodeCenter(toNode)
    const dx = b.cx - a.cx
    const dy = b.cy - a.cy
    const angle = Math.atan2(dy, dx)

    const hw = NODE_WIDTH / 2 + 2
    const hh = NODE_HEIGHT / 2 + 2
    const sx = Math.abs(Math.cos(angle)) > 0.001 ? hw / Math.abs(Math.cos(angle)) : Infinity
    const sy = Math.abs(Math.sin(angle)) > 0.001 ? hh / Math.abs(Math.sin(angle)) : Infinity
    const s = Math.min(sx, sy)

    return {
        x1: a.cx + Math.cos(angle) * s,
        y1: a.cy + Math.sin(angle) * s,
        x2: b.cx - Math.cos(angle) * s,
        y2: b.cy - Math.sin(angle) * s,
    }
}

function getNodeStatus(
    stateId: string,
    currentState: string,
    mainFlow: string[]
): 'current' | 'passed' | 'future' {
    if (stateId === currentState) return 'current'
    let currentIdx = mainFlow.indexOf(currentState)
    const stateIdx = mainFlow.indexOf(stateId)
    // 当前状态不在主流程中（如 deploying）时，
    // 把它视为"committing 之后"的位置来判断已过/未来
    if (currentIdx === -1) {
        // deploying 在 committing 之后
        const committingIdx = mainFlow.indexOf('committing')
        if (committingIdx !== -1) {
            currentIdx = committingIdx + 0.5 // 比 committing 大，但比 done 小
        }
    }
    if (stateIdx === -1 || currentIdx === -1) return 'future'
    return stateIdx < currentIdx ? 'passed' : 'future'
}

/** 为回退边计算曲线偏移量（避免与正向边重叠） */
function getCurveOffset(from: BrainGraphNode, to: BrainGraphNode, edgeIndex: number): number {
    // 基础方向
    let base: number
    if (from.y < to.y) base = 30
    else if (from.y > to.y) base = -30
    else base = from.x > to.x ? -30 : 30
    // 同一对节点间多条回退边时，逐步加大偏移避免重叠
    return base * (1 + edgeIndex * 0.5)
}

export function BrainStateMachineGraph({
    currentState,
    graphData,
}: {
    currentState?: string
    graphData: BrainGraphData
}) {
    const active = currentState || 'idle'
    const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]))

    // 过滤掉自环边（waiting 信号不需要画线）
    const rawEdges = graphData.edges.filter(e => !e.isSelfLoop)

    // 合并同一对节点间、同类型（retry/forward）的边，信号用 / 分隔
    type MergedEdge = { from: string; to: string; signals: string[]; isRetry?: boolean }
    const mergedMap = new Map<string, MergedEdge>()
    for (const edge of rawEdges) {
        const key = `${edge.from}:${edge.to}:${edge.isRetry ? 'r' : 'f'}`
        const existing = mergedMap.get(key)
        if (existing) {
            existing.signals.push(edge.signal)
        } else {
            mergedMap.set(key, { from: edge.from, to: edge.to, signals: [edge.signal], isRetry: edge.isRetry })
        }
    }
    const visibleEdges = Array.from(mergedMap.values())

    // 计算同一对节点间回退边的索引（用于分散曲线偏移）
    const retryEdgeIndexMap = new Map<number, number>()
    const retryPairCount = new Map<string, number>()
    for (let i = 0; i < visibleEdges.length; i++) {
        const edge = visibleEdges[i]
        if (!edge.isRetry) continue
        const pairKey = `${edge.from}:${edge.to}`
        const idx = retryPairCount.get(pairKey) ?? 0
        retryEdgeIndexMap.set(i, idx)
        retryPairCount.set(pairKey, idx + 1)
    }

    return (
        <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="w-full h-auto"
            style={{ maxHeight: 280 }}
        >
            <defs>
                <marker
                    id="arrow"
                    viewBox="0 0 10 7"
                    refX="9"
                    refY="3.5"
                    markerWidth="8"
                    markerHeight="6"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 3.5 L 0 7 z" fill="var(--app-hint)" />
                </marker>
                <marker
                    id="arrow-retry"
                    viewBox="0 0 10 7"
                    refX="9"
                    refY="3.5"
                    markerWidth="8"
                    markerHeight="6"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 3.5 L 0 7 z" fill="var(--app-hint)" opacity="0.4" />
                </marker>
            </defs>

            {/* 边 */}
            {visibleEdges.map((edge, i) => {
                const fromNode = nodeMap.get(edge.from)
                const toNode = nodeMap.get(edge.to)
                if (!fromNode || !toNode) return null

                const pts = getEdgePoints(fromNode, toNode)
                const label = edge.signals.join(' / ')

                if (edge.isRetry) {
                    const offset = getCurveOffset(fromNode, toNode, retryEdgeIndexMap.get(i) ?? 0)
                    const mx = (pts.x1 + pts.x2) / 2
                    const my = (pts.y1 + pts.y2) / 2
                    const dx = pts.x2 - pts.x1
                    const dy = pts.y2 - pts.y1
                    const len = Math.sqrt(dx * dx + dy * dy) || 1
                    const nx = -dy / len
                    const ny = dx / len
                    const cx = mx + nx * offset
                    const cy = my + ny * offset

                    return (
                        <g key={i}>
                            <path
                                d={`M ${pts.x1} ${pts.y1} Q ${cx} ${cy} ${pts.x2} ${pts.y2}`}
                                fill="none"
                                stroke="var(--app-hint)"
                                strokeWidth={1}
                                strokeDasharray="4 3"
                                opacity={0.4}
                                markerEnd="url(#arrow-retry)"
                            />
                            <text
                                x={cx}
                                y={cy - 4}
                                textAnchor="middle"
                                fontSize="8"
                                fill="var(--app-hint)"
                                opacity={0.5}
                            >
                                {label}
                            </text>
                        </g>
                    )
                }

                // 直线（正向边）
                const mx = (pts.x1 + pts.x2) / 2
                const my = (pts.y1 + pts.y2) / 2
                return (
                    <g key={i}>
                        <line
                            x1={pts.x1} y1={pts.y1}
                            x2={pts.x2} y2={pts.y2}
                            stroke="var(--app-hint)"
                            strokeWidth={1}
                            opacity={0.6}
                            markerEnd="url(#arrow)"
                        />
                        <text
                            x={mx}
                            y={my - 5}
                            textAnchor="middle"
                            fontSize="8"
                            fill="var(--app-hint)"
                            opacity={0.7}
                        >
                            {label}
                        </text>
                    </g>
                )
            })}

            {/* 节点 */}
            {graphData.nodes.map(node => {
                const status = getNodeStatus(node.id, active, graphData.mainFlow)

                const fillColor = status === 'current'
                    ? 'var(--app-link)'
                    : status === 'passed'
                        ? 'var(--app-secondary-bg)'
                        : 'var(--app-bg)'

                const strokeColor = status === 'current'
                    ? 'var(--app-link)'
                    : 'var(--app-border)'

                const textColor = status === 'current'
                    ? '#fff'
                    : status === 'passed'
                        ? 'var(--app-hint)'
                        : 'var(--app-fg)'

                return (
                    <g key={node.id}>
                        {status === 'current' && (
                            <rect
                                x={node.x - 3}
                                y={node.y - 3}
                                width={NODE_WIDTH + 6}
                                height={NODE_HEIGHT + 6}
                                rx={NODE_RX + 2}
                                fill="none"
                                stroke="var(--app-link)"
                                strokeWidth={1.5}
                                opacity={0.4}
                            >
                                <animate
                                    attributeName="opacity"
                                    values="0.4;0.1;0.4"
                                    dur="2s"
                                    repeatCount="indefinite"
                                />
                            </rect>
                        )}
                        <rect
                            x={node.x}
                            y={node.y}
                            width={NODE_WIDTH}
                            height={NODE_HEIGHT}
                            rx={NODE_RX}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth={status === 'current' ? 2 : 1}
                        />
                        <text
                            x={node.x + NODE_WIDTH / 2}
                            y={node.y + NODE_HEIGHT / 2}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize="12"
                            fontWeight={status === 'current' ? 600 : 400}
                            fill={textColor}
                        >
                            {node.label}
                        </text>
                        {status === 'passed' && (
                            <text
                                x={node.x + NODE_WIDTH - 8}
                                y={node.y + 10}
                                fontSize="10"
                                fill="var(--app-hint)"
                                textAnchor="middle"
                            >
                                ✓
                            </text>
                        )}
                    </g>
                )
            })}
        </svg>
    )
}
