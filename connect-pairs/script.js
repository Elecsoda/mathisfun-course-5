const SVG_NS = "http://www.w3.org/2000/svg";
const FRAME = { left: 90, top: 70, right: 710, bottom: 550 };
const LINE_RADIUS = 3;
const BLOCK_HIT_INSET = 2;
const SAMPLE_DISTANCE = 5;
const BLOCK_GAP = 8;
const PHYSICS_POINT_SPACING = 8;
const DRAG_STEP_DISTANCE = 6;
const BLOCK_LINE_CLEARANCE = 7;
const LINE_LINE_CLEARANCE = 8;
const ROPE_MAX_SEGMENT = 12;
const PHYSICS_ITERATIONS = 5;
// A* creates the initial teacher layout and is also a last-resort local
// fallback when the rope constraints cannot settle within one drag step.
const ROUTE_GRID = 6;
const OBSTACLE_PAD = BLOCK_LINE_CLEARANCE;
const LINE_PAD = LINE_LINE_CLEARANCE;
const TEACHER_PASSWORD = "math3542";
const TEACHER_DRAGGABLE_IDS = new Set(["A-top", "C-top"]);
const TEACHER_LAYOUT = {
  "C-top": { left: 175, top: 155 },
  "B-top": { left: 364, top: 70 },
  "A-top": { left: 553, top: 155 },
  "C-bottom": { left: 175, top: 478 },
  "B-bottom": { left: 364, top: 478 },
  "A-bottom": { left: 553, top: 478 },
};
const LETTER_COLORS = {
  A: { line: "#654df2", soft: "#eeeaff" },
  B: { line: "#3485ed", soft: "#e5f1ff" },
  C: { line: "#149a61", soft: "#dcf8e9" },
};

const board = document.querySelector("#drawingBoard");
const completedLinesLayer = document.querySelector("#completedLines");
const previewLayer = document.querySelector("#previewLayer");
const statusMessage = document.querySelector("#statusMessage");
const progressCount = document.querySelector("#progressCount");
const undoButton = document.querySelector("#undoButton");
const resetButton = document.querySelector("#resetButton");
const successPanel = document.querySelector("#successPanel");
const teacherModeButton = document.querySelector("#teacherModeButton");
const teacherBadge = document.querySelector("#teacherBadge");
const teacherDialog = document.querySelector("#teacherDialog");
const teacherForm = document.querySelector("#teacherForm");
const teacherPassword = document.querySelector("#teacherPassword");
const passwordError = document.querySelector("#passwordError");
const closeTeacherDialog = document.querySelector("#closeTeacherDialog");

const blockElements = [...document.querySelectorAll(".letter-block")];
const blocks = blockElements.map((element) => {
  const rect = element.querySelector("rect");
  const text = element.querySelector("text");
  const colors = LETTER_COLORS[element.dataset.letter];
  element.style.setProperty("--letter-color", colors.line);
  element.style.setProperty("--letter-soft", colors.soft);
  const left = Number(rect.getAttribute("x"));
  const top = Number(rect.getAttribute("y"));
  const width = Number(rect.getAttribute("width"));
  const height = Number(rect.getAttribute("height"));
  return {
    id: element.dataset.id,
    letter: element.dataset.letter,
    element,
    rectElement: rect,
    textElement: text,
    initialRect: { left, top, width, height },
    rect: {
      left,
      top,
      right: left + width,
      bottom: top + height,
    },
  };
});

let connections = [];
let drawing = null;
let draggedBlock = null;
let teacherMode = false;
let studentSnapshot = null;
let messageTimer;

function setMessage(message, type = "") {
  window.clearTimeout(messageTimer);
  statusMessage.textContent = message;
  statusMessage.className = `status-message${type ? ` ${type}` : ""}`;

  if (type === "error") {
    messageTimer = window.setTimeout(() => {
      if (!drawing) {
        setMessage("请从任意尚未连接的字母方块内按住并拖动。");
      }
    }, 2800);
  }
}

function svgPoint(event) {
  const point = board.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(board.getScreenCTM().inverse());
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInRect(point, rect, padding = 0) {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

function blockAt(point) {
  return blocks.find((block) => pointInRect(point, block.rect)) || null;
}

function connectedBlockIds() {
  return new Set(
    connections.flatMap((connection) => [connection.startId, connection.endId]),
  );
}

function blockById(id) {
  return blocks.find((block) => block.id === id);
}

function blockCenter(block) {
  return {
    x: (block.rect.left + block.rect.right) / 2,
    y: (block.rect.top + block.rect.bottom) / 2,
  };
}

function updateBlockPosition(block, left, top) {
  const width = block.rect.right - block.rect.left;
  const height = block.rect.bottom - block.rect.top;
  block.rect = {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
  block.rectElement.setAttribute("x", left.toFixed(1));
  block.rectElement.setAttribute("y", top.toFixed(1));
  block.textElement.setAttribute("x", (left + width / 2).toFixed(1));
  block.textElement.setAttribute("y", (top + height / 2).toFixed(1));
}

function restoreInitialBlocks() {
  blocks.forEach((block) => {
    updateBlockPosition(
      block,
      block.initialRect.left,
      block.initialRect.top,
    );
  });
}

function applyTeacherLayout() {
  blocks.forEach((block) => {
    const position = TEACHER_LAYOUT[block.id];
    updateBlockPosition(block, position.left, position.top);
  });
}

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}

function validBlockPosition(block) {
  if (
    block.rect.left < FRAME.left ||
    block.rect.right > FRAME.right ||
    block.rect.top < FRAME.top ||
    block.rect.bottom > FRAME.bottom
  ) {
    return false;
  }

  return blocks.every(
    (other) =>
      other.id === block.id ||
      !rectsOverlap(block.rect, other.rect, BLOCK_GAP),
  );
}

function orientation(a, b, c) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 0.0001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(a, b, point) {
  return (
    point.x >= Math.min(a.x, b.x) - 0.0001 &&
    point.x <= Math.max(a.x, b.x) + 0.0001 &&
    point.y >= Math.min(a.y, b.y) - 0.0001 &&
    point.y <= Math.max(a.y, b.y) + 0.0001
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) {
    return true;
  }
  if (o1 === 0 && onSegment(a, b, c)) {
    return true;
  }
  if (o2 === 0 && onSegment(a, b, d)) {
    return true;
  }
  if (o3 === 0 && onSegment(c, d, a)) {
    return true;
  }
  return o4 === 0 && onSegment(c, d, b);
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, a);
  }

  const amount = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return distance(point, {
    x: a.x + amount * dx,
    y: a.y + amount * dy,
  });
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: a.x, y: a.y, amount: 0 };
  }

  const amount = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return {
    x: a.x + amount * dx,
    y: a.y + amount * dy,
    amount,
  };
}

function expandedRect(rect, amount) {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
  };
}

function segmentTouchesRect(a, b, rect, inset = BLOCK_HIT_INSET) {
  const hitRect = {
    left: rect.left + inset,
    top: rect.top + inset,
    right: rect.right - inset,
    bottom: rect.bottom - inset,
  };

  if (pointInRect(a, hitRect) || pointInRect(b, hitRect)) {
    return true;
  }

  const topLeft = { x: hitRect.left, y: hitRect.top };
  const topRight = { x: hitRect.right, y: hitRect.top };
  const bottomRight = { x: hitRect.right, y: hitRect.bottom };
  const bottomLeft = { x: hitRect.left, y: hitRect.bottom };

  return (
    segmentsIntersect(a, b, topLeft, topRight) ||
    segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) ||
    segmentsIntersect(a, b, bottomLeft, topLeft)
  );
}

function pointOutsideFrame(point) {
  return (
    point.x < FRAME.left + LINE_RADIUS ||
    point.x > FRAME.right - LINE_RADIUS ||
    point.y < FRAME.top + LINE_RADIUS ||
    point.y > FRAME.bottom - LINE_RADIUS
  );
}

function segmentOutsideFrame(a, b) {
  return [a, b].some(
    (point) => pointOutsideFrame(point) && !blockAt(point),
  );
}

function polylineData(points) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

// Build a smooth cubic-spline SVG path through the given points.
function smoothPathData(points) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    // Catmull-Rom → cubic Bezier control points (tension 0.4)
    const t = 0.4;
    const cp1x = cur.x - (next.x - prev.x) * t / 2;
    const cp1y = cur.y - (next.y - prev.y) * t / 2;
    const cp2x = cur.x + (next.x - prev.x) * t / 2;
    const cp2y = cur.y + (next.y - prev.y) * t / 2;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${cur.x.toFixed(1)},${cur.y.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return d;
}

function createPolyline(className, points) {
  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("class", className);
  polyline.setAttribute("points", polylineData(points));
  return polyline;
}

function createSmoothPath(className, points) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", className);
  path.setAttribute("d", smoothPathData(points));
  return path;
}

// ---- Deterministic A* routing on a fine grid ----------------------------
// We route on a lattice spanning the frame. A cell is blocked if it falls
// inside any block (inflated by OBSTACLE_PAD) or too close to an existing
// line. Start/end blocks are passable so the path can leave/enter them.

function buildObstacleTest(startBlock, endBlock, routedLines) {
  const exclude = new Set([startBlock.id, endBlock.id]);
  const rects = blocks
    .filter((b) => !exclude.has(b.id))
    .map((b) => expandedRect(b.rect, OBSTACLE_PAD));
  // A small free zone around the start/end blocks where the line keep-away is
  // ignored, so the route can always exit/enter its own endpoints.
  const exits = [startBlock, endBlock].map((b) => expandedRect(b.rect, 14));
  const inExit = (x, y) =>
    exits.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

  return function blocked(x, y) {
    if (x < FRAME.left || x > FRAME.right || y < FRAME.top || y > FRAME.bottom) {
      return true;
    }
    for (const r of rects) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    if (!inExit(x, y)) {
      for (const line of routedLines) {
        for (let j = 0; j < line.length - 1; j++) {
          if (pointToSegmentDistance({ x, y }, line[j], line[j + 1]) < LINE_PAD) {
            return true;
          }
        }
      }
    }
    return false;
  };
}

// Minimal binary min-heap keyed on f-score.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < n && a[l].f < a[s].f) s = l;
        if (r < n && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

// A* over the grid. Returns array of waypoints (in px) or null.
function astar(start, goal, blocked, extraCost = () => 0) {
  const cols = Math.floor((FRAME.right - FRAME.left) / ROUTE_GRID);
  const rows = Math.floor((FRAME.bottom - FRAME.top) / ROUTE_GRID);
  const stride = cols + 1;
  const toCx = (p) => Math.max(0, Math.min(cols, Math.round((p.x - FRAME.left) / ROUTE_GRID)));
  const toCy = (p) => Math.max(0, Math.min(rows, Math.round((p.y - FRAME.top) / ROUTE_GRID)));
  const toPx = (cx, cy) => ({ x: FRAME.left + cx * ROUTE_GRID, y: FRAME.top + cy * ROUTE_GRID });

  const scx = toCx(start), scy = toCy(start);
  const gcx = toCx(goal), gcy = toCy(goal);

  // Precompute blocked grid once (-1 unknown, 0 free, 1 blocked).
  const total = stride * (rows + 1);
  const blockedGrid = new Int8Array(total).fill(-1);
  const isBlocked = (cx, cy) => {
    const k = cy * stride + cx;
    let v = blockedGrid[k];
    if (v === -1) {
      const p = toPx(cx, cy);
      v = blocked(p.x, p.y) ? 1 : 0;
      blockedGrid[k] = v;
    }
    return v === 1;
  };

  const h = (cx, cy) => Math.hypot(cx - gcx, cy - gcy);
  const gScore = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startKey = scy * stride + scx;
  gScore[startKey] = 0;
  const open = new MinHeap();
  open.push({ cx: scx, cy: scy, k: startKey, f: h(scx, scy) });

  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
  ];

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur.k]) continue;
    closed[cur.k] = 1;

    if (cur.cx === gcx && cur.cy === gcy) {
      const path = [];
      let ck = cur.k;
      while (ck !== -1) {
        path.push(toPx(ck % stride, Math.floor(ck / stride)));
        ck = came[ck];
      }
      path.reverse();
      return path;
    }
    const g = gScore[cur.k];

    for (const [dx, dy, cost] of dirs) {
      const ncx = cur.cx + dx, ncy = cur.cy + dy;
      if (ncx < 0 || ncx > cols || ncy < 0 || ncy > rows) continue;
      const nk = ncy * stride + ncx;
      if (closed[nk]) continue;
      const isGoal = ncx === gcx && ncy === gcy;
      if (!isGoal && isBlocked(ncx, ncy)) continue;
      // forbid diagonal moves that cut a blocked corner
      if (dx !== 0 && dy !== 0 &&
          isBlocked(cur.cx + dx, cur.cy) && isBlocked(cur.cx, cur.cy + dy)) {
        continue;
      }
      const nextPoint = toPx(ncx, ncy);
      const tentative = g + cost + extraCost(nextPoint.x, nextPoint.y);
      if (tentative < gScore[nk]) {
        gScore[nk] = tentative;
        came[nk] = cur.k;
        open.push({ cx: ncx, cy: ncy, k: nk, f: tentative + h(ncx, ncy) });
      }
    }
  }
  return null;
}

// Collapse a dense grid path into a minimal set of waypoints using
// line-of-sight: keep a point only when the straight shot from the last
// kept point would hit an obstacle.
function simplifyByLineOfSight(path, blocked) {
  if (path.length <= 2) return path;
  const clear = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  };
  const out = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!clear(path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

// Resample a polyline into evenly spaced points (for smooth curve control).
function resample(points, spacing) {
  if (points.length < 2) return points;
  const out = [points[0]];
  let distanceToNext = spacing;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    while (distanceToNext <= segLen) {
      const t = distanceToNext / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      distanceToNext += spacing;
    }
    distanceToNext -= segLen;
  }
  const last = points[points.length - 1];
  if (distance(out.at(-1), last) > 0.01) {
    out.push({ ...last });
  }
  return out;
}

// Main entry: deterministic route from one block to another, avoiding all
// other blocks and the already-routed lines. Returns waypoints (px) or null.
function findAutomaticRoute(startBlock, endBlock, routedLines, guidePoints = null) {
  const s = blockCenter(startBlock);
  const e = blockCenter(endBlock);
  const blocked = buildObstacleTest(startBlock, endBlock, routedLines);
  const guideCost = guidePoints
    ? (x, y) => {
        let nearest = Infinity;
        const point = { x, y };
        for (let index = 0; index < guidePoints.length - 1; index += 1) {
          nearest = Math.min(
            nearest,
            pointToSegmentDistance(
              point,
              guidePoints[index],
              guidePoints[index + 1],
            ),
          );
        }
        return Math.min(0.9, (nearest / ROUTE_GRID) * 0.08);
      }
    : undefined;

  const gridPath = astar(s, e, blocked, guideCost);
  if (!gridPath) return null;

  // Anchor exact block centers at the ends, simplify, then resample so the
  // curve renderer produces a soft, rope-like arc.
  gridPath[0] = s;
  gridPath[gridPath.length - 1] = e;
  const simplified = simplifyByLineOfSight(gridPath, blocked);
  return resample(simplified, 26);
}

function routesIntersect(first, second) {
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex += 1) {
    for (
      let secondIndex = 0;
      secondIndex < second.length - 1;
      secondIndex += 1
    ) {
      if (
        segmentsIntersect(
          first[firstIndex],
          first[firstIndex + 1],
          second[secondIndex],
          second[secondIndex + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function rerouteTeacherConnections() {
  // Route each connection in turn, treating already-routed lines as
  // obstacles so paths naturally avoid one another. Try several orderings
  // and keep the first conflict-free set; otherwise keep the best partial.
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  let fallback = null; // best all-routed-but-maybe-crossing result

  for (const order of permutations) {
    const routed = [];
    const routedPoints = [];
    let failed = false;

    for (const idx of order) {
      const connection = connections[idx];
      const route = findAutomaticRoute(
        blockById(connection.startId),
        blockById(connection.endId),
        routedPoints,
      );
      if (!route) {
        failed = true;
        break;
      }
      routed.push({ idx, route });
      routedPoints.push(route);
    }

    if (failed) continue;

    // Count crossings among the three routes
    let crossings = 0;
    for (let a = 0; a < routed.length; a++) {
      for (let b = a + 1; b < routed.length; b++) {
        if (routesIntersect(routed[a].route, routed[b].route)) crossings++;
      }
    }

    if (crossings === 0) {
      routed.forEach(({ idx, route }) => {
        connections[idx].points = resample(route, PHYSICS_POINT_SPACING);
      });
      return true;
    }

    if (!fallback || crossings < fallback.crossings) {
      fallback = { routed, crossings };
    }
  }

  // No perfectly clean layout — apply the least-crossing one we found so the
  // block can still move (the lines just touch). Reject only if nothing routed.
  if (fallback) {
    fallback.routed.forEach(({ idx, route }) => {
      connections[idx].points = resample(route, PHYSICS_POINT_SPACING);
    });
    return true;
  }
  return false;
}

function cloneConnectionPoints() {
  return connections.map((connection) =>
    connection.points.map((point) => ({ ...point })),
  );
}

function restoreConnectionPoints(snapshot) {
  connections.forEach((connection, index) => {
    connection.points = snapshot[index].map((point) => ({ ...point }));
  });
}

function anchorConnectionEndpoints() {
  connections.forEach((connection) => {
    connection.points[0] = blockCenter(blockById(connection.startId));
    connection.points[connection.points.length - 1] = blockCenter(
      blockById(connection.endId),
    );
  });
}

function constrainRopeLengths(points) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    const length = distance(first, second);
    if (length <= ROPE_MAX_SEGMENT || length === 0) continue;
    const excess = length - ROPE_MAX_SEGMENT;
    const nx = (second.x - first.x) / length;
    const ny = (second.y - first.y) / length;

    if (index === 0) {
      second.x -= nx * excess;
      second.y -= ny * excess;
    } else if (index + 1 === points.length - 1) {
      first.x += nx * excess;
      first.y += ny * excess;
    } else {
      first.x += nx * excess * 0.5;
      first.y += ny * excess * 0.5;
      second.x -= nx * excess * 0.5;
      second.y -= ny * excess * 0.5;
    }
  }

  for (let index = points.length - 1; index > 0; index -= 1) {
    const first = points[index - 1];
    const second = points[index];
    const length = distance(first, second);
    if (length <= ROPE_MAX_SEGMENT || length === 0) continue;
    const excess = length - ROPE_MAX_SEGMENT;
    const nx = (second.x - first.x) / length;
    const ny = (second.y - first.y) / length;

    if (index === points.length - 1) {
      first.x += nx * excess;
      first.y += ny * excess;
    } else if (index - 1 === 0) {
      second.x -= nx * excess;
      second.y -= ny * excess;
    } else {
      first.x += nx * excess * 0.5;
      first.y += ny * excess * 0.5;
      second.x -= nx * excess * 0.5;
      second.y -= ny * excess * 0.5;
    }
  }
}

function pushPointOutsideRect(point, rect, movement = null) {
  const obstacle = expandedRect(rect, BLOCK_LINE_CLEARANCE);
  if (!pointInRect(point, obstacle)) return false;

  const options = [
    { side: "left", distance: point.x - obstacle.left },
    { side: "right", distance: obstacle.right - point.x },
    { side: "top", distance: point.y - obstacle.top },
    { side: "bottom", distance: obstacle.bottom - point.y },
  ];
  let side = options.reduce((best, option) =>
    option.distance < best.distance ? option : best,
  ).side;

  if (movement && Math.hypot(movement.x, movement.y) > 0.01) {
    if (Math.abs(movement.x) >= Math.abs(movement.y)) {
      side = movement.x < 0 ? "left" : "right";
    } else {
      side = movement.y < 0 ? "top" : "bottom";
    }
  }

  if (side === "left") point.x = obstacle.left - 0.1;
  if (side === "right") point.x = obstacle.right + 0.1;
  if (side === "top") point.y = obstacle.top - 0.1;
  if (side === "bottom") point.y = obstacle.bottom + 0.1;
  return true;
}

function pushPointPastMovingRect(point, rect, movement) {
  const obstacle = expandedRect(rect, BLOCK_LINE_CLEARANCE);
  if (Math.abs(movement.x) >= Math.abs(movement.y)) {
    point.x = movement.x < 0 ? obstacle.left - 0.1 : obstacle.right + 0.1;
  } else {
    point.y = movement.y < 0 ? obstacle.top - 0.1 : obstacle.bottom + 0.1;
  }
}

function pushPointPastStaticRect(point, rect, reference) {
  const obstacle = expandedRect(rect, BLOCK_LINE_CLEARANCE);
  const options = [
    { side: "left", distance: Math.abs(reference.x - obstacle.left) },
    { side: "right", distance: Math.abs(reference.x - obstacle.right) },
    { side: "top", distance: Math.abs(reference.y - obstacle.top) },
    { side: "bottom", distance: Math.abs(reference.y - obstacle.bottom) },
  ];
  const side = options.reduce((best, option) =>
    option.distance < best.distance ? option : best,
  ).side;
  if (side === "left") point.x = obstacle.left - 0.1;
  if (side === "right") point.x = obstacle.right + 0.1;
  if (side === "top") point.y = obstacle.top - 0.1;
  if (side === "bottom") point.y = obstacle.bottom + 0.1;
}

function keepPointInsideFrame(point) {
  point.x = Math.max(
    FRAME.left + LINE_RADIUS,
    Math.min(FRAME.right - LINE_RADIUS, point.x),
  );
  point.y = Math.max(
    FRAME.top + LINE_RADIUS,
    Math.min(FRAME.bottom - LINE_RADIUS, point.y),
  );
}

function resolveBlockLineCollisions(movedBlock, movement) {
  connections.forEach((connection) => {
    const endpointIds = new Set([connection.startId, connection.endId]);
    blocks.forEach((block) => {
      if (endpointIds.has(block.id)) return;
      const blockMovement = block.id === movedBlock.id ? movement : null;
      for (let index = 1; index < connection.points.length - 1; index += 1) {
        const point = connection.points[index];
        pushPointOutsideRect(
          point,
          block.rect,
          blockMovement,
        );
      }

      const obstacle = expandedRect(block.rect, BLOCK_LINE_CLEARANCE);
      for (let index = 0; index < connection.points.length - 1; index += 1) {
        const first = connection.points[index];
        const second = connection.points[index + 1];
        if (!segmentTouchesRect(first, second, obstacle, 0)) continue;
        const midpoint = {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        };
        if (index > 0) {
          if (blockMovement) {
            pushPointPastMovingRect(first, block.rect, blockMovement);
          } else {
            pushPointPastStaticRect(first, block.rect, midpoint);
          }
        }
        if (index + 1 < connection.points.length - 1) {
          if (blockMovement) {
            pushPointPastMovingRect(second, block.rect, blockMovement);
          } else {
            pushPointPastStaticRect(second, block.rect, midpoint);
          }
        }
      }
    });

    for (let index = 1; index < connection.points.length - 1; index += 1) {
      const point = connection.points[index];
      keepPointInsideFrame(point);
    }
  });
}

function separateLineFromLine(first, second, movement) {
  for (let pointIndex = 1; pointIndex < first.length - 1; pointIndex += 1) {
    const point = first[pointIndex];
    for (let segmentIndex = 0; segmentIndex < second.length - 1; segmentIndex += 1) {
      const segmentStart = second[segmentIndex];
      const segmentEnd = second[segmentIndex + 1];
      if (
        point.x < Math.min(segmentStart.x, segmentEnd.x) - LINE_LINE_CLEARANCE ||
        point.x > Math.max(segmentStart.x, segmentEnd.x) + LINE_LINE_CLEARANCE ||
        point.y < Math.min(segmentStart.y, segmentEnd.y) - LINE_LINE_CLEARANCE ||
        point.y > Math.max(segmentStart.y, segmentEnd.y) + LINE_LINE_CLEARANCE
      ) {
        continue;
      }
      const closest = closestPointOnSegment(
        point,
        segmentStart,
        segmentEnd,
      );
      let dx = point.x - closest.x;
      let dy = point.y - closest.y;
      let gap = Math.hypot(dx, dy);
      if (gap >= LINE_LINE_CLEARANCE) continue;

      if (gap < 0.001) {
        const segment = {
          x: segmentEnd.x - segmentStart.x,
          y: segmentEnd.y - segmentStart.y,
        };
        dx = -segment.y;
        dy = segment.x;
        gap = Math.hypot(dx, dy) || 1;
        if (dx * movement.x + dy * movement.y < 0) {
          dx *= -1;
          dy *= -1;
        }
      }

      const push = (LINE_LINE_CLEARANCE - gap + 0.1) * 0.55;
      const nx = dx / gap;
      const ny = dy / gap;
      point.x += nx * push;
      point.y += ny * push;

      const firstSegmentPoint = second[segmentIndex];
      const secondSegmentPoint = second[segmentIndex + 1];
      if (segmentIndex > 0) {
        firstSegmentPoint.x -= nx * push * (1 - closest.amount);
        firstSegmentPoint.y -= ny * push * (1 - closest.amount);
      }
      if (segmentIndex + 1 < second.length - 1) {
        secondSegmentPoint.x -= nx * push * closest.amount;
        secondSegmentPoint.y -= ny * push * closest.amount;
      }
    }
  }
}

function resolveLineLineCollisions(movement) {
  for (let firstIndex = 0; firstIndex < connections.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < connections.length;
      secondIndex += 1
    ) {
      const first = connections[firstIndex].points;
      const second = connections[secondIndex].points;
      separateLineFromLine(first, second, movement);
      separateLineFromLine(second, first, movement);
    }
  }
}

function teacherRoutesAreClear() {
  for (const connection of connections) {
    const endpointIds = new Set([connection.startId, connection.endId]);
    for (let index = 0; index < connection.points.length - 1; index += 1) {
      const a = connection.points[index];
      const b = connection.points[index + 1];
      if (pointOutsideFrame(a) || pointOutsideFrame(b)) return false;
      for (const block of blocks) {
        if (endpointIds.has(block.id)) continue;
        if (
          segmentTouchesRect(
            a,
            b,
            expandedRect(block.rect, BLOCK_LINE_CLEARANCE - 0.5),
            0,
          )
        ) {
          return false;
        }
      }
    }
  }

  for (let first = 0; first < connections.length; first += 1) {
    for (let second = first + 1; second < connections.length; second += 1) {
      if (routesIntersect(connections[first].points, connections[second].points)) {
        return false;
      }
    }
  }
  return true;
}

function pushTeacherConnections(movedBlock, movement) {
  anchorConnectionEndpoints();

  for (let iteration = 0; iteration < PHYSICS_ITERATIONS; iteration += 1) {
    connections.forEach((connection) => constrainRopeLengths(connection.points));
    anchorConnectionEndpoints();
    resolveBlockLineCollisions(movedBlock, movement);
    resolveLineLineCollisions(movement);
    resolveBlockLineCollisions(movedBlock, movement);
    anchorConnectionEndpoints();
  }

  return teacherRoutesAreClear();
}

function rerouteTeacherConnectionsGuided(movedBlock, previousRoutes) {
  const movedConnectionIndex = connections.findIndex(
    (connection) =>
      connection.startId === movedBlock.id || connection.endId === movedBlock.id,
  );
  const remaining = connections
    .map((_, index) => index)
    .filter((index) => index !== movedConnectionIndex);
  const orders = [
    [movedConnectionIndex, ...remaining],
    [movedConnectionIndex, ...remaining.slice().reverse()],
  ];

  for (const order of orders) {
    const routes = new Array(connections.length);
    const routedLines = [];
    let failed = false;

    for (const index of order) {
      const connection = connections[index];
      const route = findAutomaticRoute(
        blockById(connection.startId),
        blockById(connection.endId),
        routedLines,
        previousRoutes[index],
      );
      if (!route) {
        failed = true;
        break;
      }
      routes[index] = resample(route, PHYSICS_POINT_SPACING);
      routedLines.push(routes[index]);
    }

    if (failed) continue;
    routes.forEach((route, index) => {
      connections[index].points = route;
    });
    if (teacherRoutesAreClear()) return true;
  }

  restoreConnectionPoints(previousRoutes);
  return false;
}

function moveTeacherBlock(block, targetLeft, targetTop) {
  const startLeft = block.rect.left;
  const startTop = block.rect.top;
  const dx = targetLeft - startLeft;
  const dy = targetTop - startTop;
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(dx, dy) / DRAG_STEP_DISTANCE),
  );

  for (let step = 1; step <= steps; step += 1) {
    const previousRect = { ...block.rect };
    const previousRoutes = cloneConnectionPoints();
    const left = startLeft + (dx * step) / steps;
    const top = startTop + (dy * step) / steps;
    const movement = {
      x: left - previousRect.left,
      y: top - previousRect.top,
    };

    updateBlockPosition(block, left, top);
    if (!validBlockPosition(block)) {
      updateBlockPosition(block, previousRect.left, previousRect.top);
      restoreConnectionPoints(previousRoutes);
      return false;
    }
    if (!pushTeacherConnections(block, movement)) {
      restoreConnectionPoints(previousRoutes);
      if (!rerouteTeacherConnectionsGuided(block, previousRoutes)) {
        updateBlockPosition(block, previousRect.left, previousRect.top);
        restoreConnectionPoints(previousRoutes);
        return false;
      }
    }
  }
  return true;
}

function ensureTeacherConnections() {
  const byLetter = new Map(connections.map((connection) => [connection.letter, connection]));
  connections = Object.keys(LETTER_COLORS).map((letter) => {
    if (byLetter.has(letter)) {
      return byLetter.get(letter);
    }
    const pair = blocks.filter((block) => block.letter === letter);
    return {
      letter,
      startId: pair[0].id,
      endId: pair[1].id,
      points: [],
    };
  });
  return rerouteTeacherConnections();
}

function validateNewSegment(a, b) {
  if (segmentOutsideFrame(a, b)) {
    return "连线不能超出外框。";
  }

  for (const block of blocks) {
    const isStart = block.id === drawing.start.id;
    const wasInsideStart = pointInRect(a, drawing.start.rect, LINE_RADIUS);
    const isEnteredBlock = pointInRect(b, block.rect, LINE_RADIUS);
    const isValidTarget =
      block.letter === drawing.start.letter &&
      block.id !== drawing.start.id &&
      !connectedBlockIds().has(block.id);

    if (isStart && wasInsideStart) {
      continue;
    }

    if (segmentTouchesRect(a, b, block.rect)) {
      if (isEnteredBlock && isValidTarget) {
        continue;
      }
      return "连线不能穿过字母方块。";
    }
  }

  // Adjacent samples naturally sit close together. For the line currently
  // being drawn, only a real intersection or retraced segment is a self-cross.
  for (let index = 0; index < drawing.points.length - 2; index += 1) {
    if (
      segmentsIntersect(
        a,
        b,
        drawing.points[index],
        drawing.points[index + 1],
      )
    ) {
      return "连线不能和自己交叉。";
    }
  }

  for (const connection of connections) {
    for (let index = 0; index < connection.points.length - 1; index += 1) {
      if (
        segmentsIntersect(
          a,
          b,
          connection.points[index],
          connection.points[index + 1],
        )
      ) {
        return "连线发生交叉，请换一条路线。";
      }
    }
  }

  return "";
}

function addInterpolatedPoints(target) {
  const last = drawing.points.at(-1);
  const totalDistance = distance(last, target);
  const steps = Math.max(1, Math.ceil(totalDistance / SAMPLE_DISTANCE));

  for (let step = 1; step <= steps; step += 1) {
    const point = {
      x: last.x + ((target.x - last.x) * step) / steps,
      y: last.y + ((target.y - last.y) * step) / steps,
    };
    const previous = drawing.points.at(-1);
    const problem = validateNewSegment(previous, point);
    drawing.points.push(point);

    if (problem && !drawing.problem) {
      drawing.problem = problem;
    }
  }
}

function renderPreview() {
  previewLayer.replaceChildren();
  if (!drawing || drawing.points.length < 2) {
    return;
  }

  const invalidClass = drawing.problem ? " invalid" : "";
  const line = createSmoothPath(`preview-line${invalidClass}`, drawing.points);
  const tip = document.createElementNS(SVG_NS, "circle");
  const last = drawing.points.at(-1);
  const colors = LETTER_COLORS[drawing.start.letter];
  line.style.setProperty("--letter-color", colors.line);
  tip.setAttribute("class", `preview-tip${invalidClass}`);
  tip.style.setProperty("--letter-color", colors.line);
  tip.setAttribute("cx", String(last.x));
  tip.setAttribute("cy", String(last.y));
  tip.setAttribute("r", "9");
  previewLayer.append(line, tip);
}

function renderConnections() {
  completedLinesLayer.replaceChildren();

  connections.forEach((connection, index) => {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "line-group");
    group.dataset.index = String(index);
    group.style.setProperty(
      "--letter-color",
      LETTER_COLORS[connection.letter].line,
    );

    const visible = teacherMode
      ? createPolyline("completed-line", connection.points)
      : createSmoothPath("completed-line", connection.points);
    const hitArea = teacherMode
      ? createPolyline("completed-line-hit", connection.points)
      : createSmoothPath("completed-line-hit", connection.points);
    hitArea.addEventListener("click", () => {
      if (teacherMode) {
        return;
      }
      connections.splice(index, 1);
      render();
      setMessage(`已移除 ${connection.letter} 的连线。`);
    });
    group.append(visible, hitArea);
    completedLinesLayer.appendChild(group);
  });
}

function renderBlocks() {
  const connectedIds = connectedBlockIds();
  blockElements.forEach((element) => {
    const id = element.dataset.id;
    element.classList.toggle("connected", connectedIds.has(id));
    element.classList.toggle("available", !teacherMode && !connectedIds.has(id));
    element.classList.toggle("starting", drawing?.start.id === id);
    element.classList.toggle("dragging", draggedBlock?.block.id === id);
    element.classList.toggle(
      "teacher-draggable",
      teacherMode && TEACHER_DRAGGABLE_IDS.has(id),
    );
    element.classList.toggle(
      "teacher-locked",
      teacherMode && !TEACHER_DRAGGABLE_IDS.has(id),
    );
    element.classList.toggle(
      "conflict",
      Boolean(drawing?.problem && blockAt(drawing.points.at(-1))?.id === id),
    );
  });
}

function render() {
  renderConnections();
  renderPreview();
  renderBlocks();
  board.classList.toggle("teacher-mode", teacherMode);
  teacherModeButton.classList.toggle("active", teacherMode);
  teacherModeButton.textContent = teacherMode
    ? "退出教师演示"
    : "教师演示模式";
  teacherBadge.hidden = !teacherMode;
  progressCount.textContent = `${connections.length} / 3`;
  undoButton.disabled = teacherMode || connections.length === 0;
  successPanel.hidden = connections.length !== 3;

  if (connections.length === 3) {
    setMessage("全部连接成功，三条路线互不相交！", "success");
  }
}

function cancelDrawing(message, type = "error") {
  drawing = null;
  previewLayer.replaceChildren();
  renderBlocks();
  setMessage(message, type);
}

function finishDrawing(point) {
  addInterpolatedPoints(point);
  const end = blockAt(point);

  if (drawing.problem) {
    cancelDrawing(drawing.problem);
    return;
  }
  if (!end || end.id === drawing.start.id) {
    cancelDrawing("请把连线终点放在另一个字母方块内。");
    return;
  }
  if (connectedBlockIds().has(end.id)) {
    cancelDrawing("这个字母方块已经完成连接。");
    return;
  }
  if (end.letter !== drawing.start.letter) {
    const startLetter = drawing.start.letter;
    cancelDrawing(`起点是 ${startLetter}，终点也必须是 ${startLetter}。`);
    return;
  }

  connections.push({
    letter: drawing.start.letter,
    startId: drawing.start.id,
    endId: end.id,
    points: drawing.points,
  });
  const letter = drawing.start.letter;
  drawing = null;
  render();

  if (connections.length < 3) {
    setMessage(`${letter} 已连接成功，继续完成其他字母。`, "success");
  }
}

board.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") {
    return;
  }

  if (teacherMode) {
    const point = svgPoint(event);
    const block = blockAt(point);
    if (!block) {
      return;
    }
    if (!TEACHER_DRAGGABLE_IDS.has(block.id)) {
      setMessage("教师演示模式下，只能移动上方的 A 和 C。", "error");
      return;
    }
    event.preventDefault();
    board.setPointerCapture(event.pointerId);
    draggedBlock = {
      block,
      pointerId: event.pointerId,
      offsetX: point.x - block.rect.left,
      offsetY: point.y - block.rect.top,
    };
    renderBlocks();
    setMessage(`正在移动 ${block.letter} 方块，连线会自动重新规划。`);
    return;
  }

  if (event.target.closest(".line-group")) {
    return;
  }

  const point = svgPoint(event);
  const start = blockAt(point);
  if (!start) {
    setMessage("请从字母方块内部开始画线。", "error");
    return;
  }
  if (connectedBlockIds().has(start.id)) {
    setMessage(`${start.letter} 已经连接完成，可点击已有连线删除后重画。`, "error");
    return;
  }

  event.preventDefault();
  board.setPointerCapture(event.pointerId);
  drawing = {
    pointerId: event.pointerId,
    start,
    points: [point],
    problem: "",
  };
  setMessage(`正在连接 ${start.letter}，请拖到另一个 ${start.letter}。`);
  render();
});

board.addEventListener("pointermove", (event) => {
  if (draggedBlock && event.pointerId === draggedBlock.pointerId) {
    event.preventDefault();
    const point = svgPoint(event);
    const block = draggedBlock.block;
    const width = block.rect.right - block.rect.left;
    const height = block.rect.bottom - block.rect.top;
    const left = Math.max(
      FRAME.left,
      Math.min(FRAME.right - width, point.x - draggedBlock.offsetX),
    );
    const top = Math.max(
      FRAME.top,
      Math.min(FRAME.bottom - height, point.y - draggedBlock.offsetY),
    );

    if (!moveTeacherBlock(block, left, top)) {
      setMessage("线路已经没有足够的避让空间，请换一个方向移动。", "error");
    } else {
      setMessage(`正在移动 ${block.letter}，接触到的线路会依次被推开。`);
    }
    renderConnections();
    renderBlocks();
    return;
  }

  if (!drawing || event.pointerId !== drawing.pointerId) {
    return;
  }

  event.preventDefault();
  const point = svgPoint(event);
  if (distance(drawing.points.at(-1), point) < 2) {
    return;
  }

  addInterpolatedPoints(point);
  renderPreview();
  renderBlocks();

  if (drawing.problem) {
    setMessage(drawing.problem, "error");
  }
});

board.addEventListener("pointerup", (event) => {
  if (draggedBlock && event.pointerId === draggedBlock.pointerId) {
    event.preventDefault();
    const letter = draggedBlock.block.letter;
    draggedBlock = null;
    render();
    setMessage(`${letter} 方块移动完成，连线保持互不相交。`, "success");
    return;
  }

  if (!drawing || event.pointerId !== drawing.pointerId) {
    return;
  }
  event.preventDefault();
  finishDrawing(svgPoint(event));
});

board.addEventListener("pointercancel", () => {
  if (draggedBlock) {
    draggedBlock = null;
    render();
    setMessage("方块移动已结束。");
    return;
  }
  if (drawing) {
    cancelDrawing("本次画线已取消。", "");
  }
});

undoButton.addEventListener("click", () => {
  const removed = connections.pop();
  if (!removed) {
    return;
  }
  render();
  setMessage(`已撤销 ${removed.letter} 的连线。`);
});

resetButton.addEventListener("click", () => {
  if (teacherMode) {
    applyTeacherLayout();
  } else {
    restoreInitialBlocks();
  }
  connections = teacherMode ? connections : [];
  drawing = null;
  draggedBlock = null;
  if (teacherMode) {
    ensureTeacherConnections();
  }
  render();
  setMessage(
    teacherMode
      ? "已恢复初始布局，可以继续拖动方块演示。"
      : "画板已清空，请从任意字母方块开始。",
  );
});

function enterTeacherMode() {
  studentSnapshot = {
    positions: blocks.map((block) => ({
      id: block.id,
      left: block.rect.left,
      top: block.rect.top,
    })),
    connections: connections.map((connection) => ({
      ...connection,
      points: connection.points.map((point) => ({ ...point })),
    })),
  };
  teacherMode = true;
  drawing = null;
  draggedBlock = null;
  applyTeacherLayout();
  connections = [];
  if (!ensureTeacherConnections()) {
    setMessage("教师演示初始线路生成失败，请重新开始。", "error");
    return;
  }
  render();
  setMessage(
    "教师演示模式已开启：拖动上方 A、C，观察三条线路自动避让。",
    "success",
  );
}

function exitTeacherMode() {
  teacherMode = false;
  draggedBlock = null;
  if (studentSnapshot) {
    studentSnapshot.positions.forEach((position) => {
      const block = blockById(position.id);
      updateBlockPosition(block, position.left, position.top);
    });
    connections = studentSnapshot.connections;
    studentSnapshot = null;
  }
  render();
  setMessage("已退出教师演示模式，可以继续自由连线。");
}

teacherModeButton.addEventListener("click", () => {
  if (teacherMode) {
    exitTeacherMode();
    return;
  }
  passwordError.hidden = true;
  teacherPassword.value = "";
  teacherDialog.showModal();
  window.setTimeout(() => teacherPassword.focus(), 0);
});

teacherForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (teacherPassword.value !== TEACHER_PASSWORD) {
    passwordError.hidden = false;
    teacherPassword.select();
    return;
  }
  teacherDialog.close();
  enterTeacherMode();
});

closeTeacherDialog.addEventListener("click", () => {
  teacherDialog.close();
});

teacherPassword.addEventListener("input", () => {
  passwordError.hidden = true;
});

render();
