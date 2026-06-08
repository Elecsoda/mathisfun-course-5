const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
    this.children = [];
    this.hidden = false;
    this.textContent = "";
    this.value = "";
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener() {}
  setPointerCapture() {}
  showModal() {}
  close() {}
  focus() {}
  select() {}
  closest() {
    return null;
  }
}

const blockData = [
  ["A-top", "A", 175, 155],
  ["B-top", "B", 364, 70],
  ["C-top", "C", 553, 155],
  ["C-bottom", "C", 175, 478],
  ["B-bottom", "B", 364, 478],
  ["A-bottom", "A", 553, 478],
];

const blockElements = blockData.map(([id, letter, x, y]) => {
  const group = new FakeElement();
  const rect = new FakeElement({ x, y, width: 72, height: 72 });
  const text = new FakeElement({ x: x + 36, y: y + 36 });
  group.dataset = { id, letter };
  group.querySelector = (selector) => (selector === "rect" ? rect : text);
  return group;
});

const elements = new Map();
const board = new FakeElement();
board.createSVGPoint = () => ({
  x: 0,
  y: 0,
  matrixTransform() {
    return this;
  },
});
board.getScreenCTM = () => ({ inverse: () => ({}) });
elements.set("#drawingBoard", board);

const documentStub = {
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, new FakeElement());
    return elements.get(selector);
  },
  querySelectorAll(selector) {
    return selector === ".letter-block" ? blockElements : [];
  },
  createElementNS() {
    return new FakeElement();
  },
};

const source = fs.readFileSync(
  require.resolve("./script.js"),
  "utf8",
).replace(
  /\nrender\(\);\s*$/,
  `
enterTeacherMode();
if (connections.length !== 3) throw new Error("Teacher routes were not created");
if (!teacherRoutesAreClear()) throw new Error("Initial teacher routes collide");

const aBlock = blockById("A-top");
const cBlock = blockById("C-top");
if (!moveTeacherBlock(aBlock, 470, 255)) {
  throw new Error("A could not move to the middle");
}
if (!moveTeacherBlock(cBlock, 550, 155)) {
  throw new Error("C could not move to the upper-right");
}

const before = new Map(
  connections.map((connection) => [
    connection.letter,
    connection.points.map((point) => ({ ...point })),
  ]),
);
const moved = moveTeacherBlock(aBlock, 420, 255);
if (!moved) throw new Error("A could not continue moving left");
if (!teacherRoutesAreClear()) throw new Error("Routes collide after moving A");

const displacedOtherLine = connections
  .filter((connection) => connection.letter !== "A")
  .some((connection) =>
    connection.points.some((point, index) => {
      const oldPoint = before.get(connection.letter)[index];
      return oldPoint && Math.hypot(point.x - oldPoint.x, point.y - oldPoint.y) > 0.5;
    }),
  );
if (!displacedOtherLine) throw new Error("Moving A did not push another line");
console.log("physics smoke test passed");
`,
);

vm.runInNewContext(source, {
  console,
  document: documentStub,
  window: {
    clearTimeout() {},
    setTimeout() {},
  },
  Math,
  Map,
  Set,
  Int8Array,
  Int32Array,
  Float64Array,
  Uint8Array,
});
