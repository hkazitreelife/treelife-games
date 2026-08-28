// Headless harness: runs the EXACT shipped game script in a VM sandbox with a
// minimal DOM stub and verifies the arcade bot responds on its turn across
// five consecutive games, including rapid double-click abuse and toggles.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/games/tictactoe/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

class El {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.style = {};
    this._cls = new Set();
    this.textContent = "";
  }
  // Minimal innerHTML: extract plain text from simple span/markup content.
  set innerHTML(v) {
    const s = String(v);
    const m = s.match(/<span[^>]*>([\s\S]*?)<\/span>/);
    this.textContent = m ? m[1] : s.replace(/<[^>]*>/g, "");
  }
  get innerHTML() { return this.textContent; }
  get classList() {
    const s = this._cls;
    return {
      add: (...a) => a.forEach((x) => s.add(x)),
      remove: (...a) => a.forEach((x) => s.delete(x)),
      toggle: (c, f) => {
        const on = f === undefined ? !s.has(c) : !!f;
        on ? s.add(c) : s.delete(c);
      },
      contains: (c) => s.has(c),
    };
  }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  appendChild(ch) { this.children.push(ch); return ch; }
  click() { (this.listeners.click || []).forEach((f) => f({})); }
}

function makeSandbox() {
  const els = {};
  ["board", "turnLabel", "timerFill", "hint", "overlay", "ovTitle", "ovSub", "nextBtn", "scoreX", "scoreO"]
    .forEach((id) => (els[id] = new El()));
  const winListeners = {};
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Infinity,
    document: {
      createElement: () => new El(),
      getElementById: (id) => els[id] || null,
      body: new El(),
    },
    window: null,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.window = {
    addEventListener: (t, f) => (winListeners[t] = winListeners[t] || []).push(f),
    parent: { postMessage: () => {} },
  };
  sandbox.window.dispatchEventMessage = (msg) =>
    (winListeners.message || []).forEach((f) => f({ data: msg }));
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { sandbox, els };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playGame(n, opts = {}) {
  const { els, sandbox } = makeSandbox();
  const cells = () => els.board.children;
  const board = () => cells().map((c) => c.textContent);
  const turn = () => (els.turnLabel.textContent.includes("X") ? "X" : "O");
  const over = () => els.overlay.classList.contains("show");

  // Toggle the bot ON, then OFF, then back ON rapidly — worst-case toggle abuse.
  sandbox.window.dispatchEventMessage({ type: "arcade-bot", on: true });
  sandbox.window.dispatchEventMessage({ type: "arcade-bot", on: false });
  sandbox.window.dispatchEventMessage({ type: "arcade-bot", on: true });

  const violations = [];
  let plies = 0;
  let botReplies = 0;
  let humanMoves = 0;

  while (!over() && plies < 60 && humanMoves < 8 && botReplies < 6) {
    if (turn() === "X") {
      const empties = board().map((v, i) => (v === "" ? i : -1)).filter((i) => i >= 0);
      if (!empties.length) break;
      // RAPID double-click: two synchronous clicks, zero pause between them.
      cells()[empties[0]].click();
      if (empties[1] !== undefined) cells()[empties[1]].click();
      humanMoves++;
      plies++;
      // The bot must answer within its 500ms delay + slack.
      const before = JSON.stringify(board());
      await sleep(750);
      if (!over()) {
        if (turn() !== "X") violations.push(`bot did not return turn to X after human move ${humanMoves} (turn=${turn()})`);
        else botReplies++;
        const after = board();
        const xCount = after.filter((v) => v === "X").length;
        const oCount = after.filter((v) => v === "O").length;
        if (xCount > 3 || oCount > 3) violations.push(`sliding rule violated: qX=${xCount} qO=${oCount}`);
        if (JSON.stringify(after) === before) violations.push("board unchanged after full exchange");
      }
    } else {
      await sleep(60);
      plies++;
    }
  }

  const ok = !over() || true; // both outcomes fine; we care about violations
  return { n, over: over(), title: els.ovTitle.textContent, botReplies, humanMoves, violations, ok };
}

let failures = 0;
for (let g = 1; g <= 5; g++) {
  const r = await playGame(g);
  const bad = r.violations.length > 0;
  if (bad) failures++;
  console.log(
    `game ${g}: ${bad ? "FAIL" : "PASS"} | botReplies=${r.botReplies} humanMoves=${r.humanMoves} | ${r.title || "in-progress"}${r.violations.length ? " | " + r.violations.join("; ") : ""}`
  );
}

// Also verify the ack handshake exists in the shipped script.
if (!script.includes("arcade-bot-ack")) { console.log("handshake: FAIL (no ack sent)"); failures++; }
else console.log("handshake: PASS (game acknowledges arcade-bot messages)");

process.exit(failures ? 1 : 0);
