/* Minimal Piu app: centered tappable box (no fonts) */
import { Application, Container, Skin, Behavior } from "piu/MC";
import { connect } from "transport-moddable";

const whiteSkin = new Skin({ fill: "white" });
const blueSkin = new Skin({ fill: ["#2d9cdb", "#1b6fa1", "#2d9cdb", "#2d9cdb"] });
const zoneSkin = new Skin({ fill: "#f2f2f2" });
const zoneSkinSlow = new Skin({ fill: "#ffd54f" });
const zoneSkinStop = new Skin({ fill: "#ef5350" });
// knob: state 0 = disconnected (dark), state 1 = connected (light)
const knobSkin = new Skin({
  fill: ["#888888", "#ffffff", "#888888", "#888888"],
  stroke: ["#444444", "#666666", "#444444", "#444444"],
  borders: { left: 1, right: 1, top: 1, bottom: 1 }
});

// --- Joystick control state
const JOY_SIZE = 270;
const KNOB_SIZE = 72;
const DEAD_X = 0.3;
const DEAD_Y = 0.2;
const TURN_INPLACE = 1.5; // in-place rotation
const SEND_INTERVAL_MS = 1000 / 24;
const MAX_SPEED = 0.7;

// --- Connection state
const CONN = {
  state: "idle", // idle | connecting | connected | reconnecting | disconnected | closed | error
  set(state) {
    this.state = state;
    try { trace(`conn: ${state}\n`); } catch {}
  },
  isConnected() { return this.state === "connected"; }
};

let isSending = false;
function createZeroTwist() {
  return {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };
}
let twist = createZeroTwist();
let sendTimer = null;

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
function abs(v) { return v < 0 ? -v : v; }
function axisWithDeadzone(v, dead) {
  const a = abs(v);
  if (a <= dead) return 0;
  const sign = v < 0 ? -1 : 1;
  const t = (a - dead) / (1 - dead);
  return sign * clamp(t, 0, 1);
}
function setKnobPosition(knob, left, top) {
  try {
    if (!knob) return;
    // Prefer direct x/y if available
    if ("x" in knob) knob.x = left;
    if ("y" in knob) knob.y = top;
    // Fallback to coordinates if supported
    if ("coordinates" in knob) {
      const c = knob.coordinates || {};
      knob.coordinates = { left, top, width: c.width || KNOB_SIZE, height: c.height || KNOB_SIZE };
    }
  } catch {}
}
function computeTwistFromAxes(nx, ny) {
  const vel = axisWithDeadzone(ny, DEAD_Y);
  const turn = axisWithDeadzone(nx, DEAD_X);

  let linearSpeed = Math.min(MAX_SPEED, Math.abs(vel));
  if (vel < 0) linearSpeed *= 0.5; // backward: half speed

  const linearX = vel >= 0 ? linearSpeed : -linearSpeed;
  const angularZ = clamp(turn * TURN_INPLACE, -TURN_INPLACE, TURN_INPLACE);

  return {
    linear: { x: linearX, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: angularZ },
  };
}

function publishMove() {
  try {
    if (!globalThis.nc || !CONN.isConnected()) return;
    const payload = {
      linear: { ...twist.linear },
      angular: { ...twist.angular },
    };
    globalThis.nc.publish("demo.twist", JSON.stringify(payload));
  } catch (e) {
    try { trace(`publish error: ${e?.message || e}\n`); } catch {}
  }
}

export default function() {
  return new Application(null, {
    skin: whiteSkin,
    contents: [
      // ControlView container wrapping the Joystick zone
      new Container(null, {
        anchor: "controlView",
        width: JOY_SIZE, height: JOY_SIZE,
        horizontal: "center", vertical: "middle",
        skin: zoneSkin,
        radius: JOY_SIZE >> 1,
        active: true,
        contents: [
          // Joystick zone
          new Container(null, {
            anchor: "joystick",
            width: JOY_SIZE, height: JOY_SIZE,
            skin: zoneSkin,
            radius: JOY_SIZE >> 1,
            active: true,
            contents: [
              new Container(null, {
                anchor: "knob",
                width: KNOB_SIZE, height: KNOB_SIZE,
                left: (JOY_SIZE - KNOB_SIZE) >> 1, top: (JOY_SIZE - KNOB_SIZE) >> 1,
                skin: knobSkin,
                radius: KNOB_SIZE >> 1,
              })
            ],
            Behavior: class extends Behavior {
              onCreate(c) {
                this.enabled = false; // disabled until connected
                // start periodic sender
                if (!sendTimer) sendTimer = setInterval(() => { if (isSending && this.enabled) publishMove(); }, SEND_INTERVAL_MS);
                // ensure knob is centered
                const cx = (JOY_SIZE - KNOB_SIZE) >> 1;
                const cy = (JOY_SIZE - KNOB_SIZE) >> 1;
                const knob = c.first;
                knob.state = CONN.isConnected() ? 1 : 0;
                setKnobPosition(knob, cx, cy);
              }
              onConnStateChange(c, state) {
                trace(`onConnStateChange: ${state}\n`);
                const connected = state === "connected";
                this.enabled = connected;
                try { const knob = c.first; knob.state = connected ? 1 : 0; } catch {}
                if (!connected) {
                  // stop sending and reset position
                  isSending = false;
                  twist = createZeroTwist();
                  const cx = (JOY_SIZE - KNOB_SIZE) >> 1;
                  const cy = (JOY_SIZE - KNOB_SIZE) >> 1;
                  const knob = c.first;
                  setKnobPosition(knob, cx, cy);
                }
              }
              onTouchBegan(c, id, x, y) {
                trace(`touchBegan\n`);
                if (!this.enabled) return; // ignore while disconnected/connecting
                this._update(c, x, y);
                isSending = true;
              }
              onTouchMoved(c, id, x, y) {
                if (!this.enabled) return;
                this._update(c, x, y);
              }
              onTouchEnded(c, id, x, y) {
                trace(`touchEnded\n`);
                if (!this.enabled) return;
                isSending = false;
                twist = createZeroTwist();
                // snap knob to center in zone coordinates
                const cx = (JOY_SIZE - KNOB_SIZE) >> 1;
                const cy = (JOY_SIZE - KNOB_SIZE) >> 1;
                const knob = c.first; // per Piu pattern: first content
                setKnobPosition(knob, cx, cy);
                // immediate stop packet
                publishMove();
              }
              _update(c, x, y) {
                x -= c.x;
                y -= c.y;
                // x, y are in the container's coordinate space per Piu MC
                const cx = JOY_SIZE / 2;
                const cy = JOY_SIZE / 2;
                const dx = x - cx;
                const dy = y - cy;
                const radius = (JOY_SIZE - KNOB_SIZE) / 2;
                // limit to circle
                let len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                const scale = len > radius ? radius / len : 1;
                const lx = dx * scale;
                const ly = dy * scale;

                // place knob (convert y-up: in UI +y is down, so invert)
                const kx = (cx + lx) - (KNOB_SIZE / 2);
                const ky = (cy + ly) - (KNOB_SIZE / 2);
                const knob = c.first;
                setKnobPosition(knob, kx, ky);

                // normalize to [-1, 1], y-up
                const nx = clamp(lx / radius, -1, 1);
                const ny = clamp(-ly / radius, -1, 1);

                // Map joystick axes to ROS 2 Twist (linear.x, angular.z)
                twist = computeTwistFromAxes(nx, ny);
              }
            }
          })
        ],
        Behavior: class extends Behavior {
          onCreate(c) {
            // kick off connection on ControlView creation
            Promise.resolve().then(() => setupNats(c)).catch(e => trace(`setup error: ${e?.message || e}\n`));
          }
          onStatusChanged(c, state) {
            trace(`onStatusChanged: ${state}\n`)
            // broadcast connection state changes to children
            c.distribute("onConnStateChange", state);
          }
          setSafetyState(c, state) {
            // state: normal | slow | stop
            const j = c.first;
            let sk = zoneSkin;
            switch (state) {
              case "slow": sk = zoneSkinSlow; break;
              case "stop": sk = zoneSkinStop; break;
              case "normal":
              default:
                sk = zoneSkin;
            }
            try { if (j) j.skin = sk; } catch {}
            try { c.skin = sk; } catch {}
          }
        }
      })
    ],
  });
}

async function setupNats(controlView) {
  // reflect state to UI
  function update(state) {
    CONN.set(state);
    try { controlView.behavior.onStatusChanged(controlView, state); } catch {}
  }

  update("connecting");
  try {
    const nc = await connect({
      servers: ["nats://127.0.0.1:4222"],
      name: "moddable",
      reconnect: true,
      waitOnFirstConnect: true,
      maxReconnectAttempts: -1,
      // reconnectTimeWait: 2000, // leave default unless tuned
    });
    globalThis.nc = nc;
    update("connected");

    // listen for status events to reflect connection state
    (async () => {
      try {
        for await (const s of nc.status()) {
          switch (s.type) {
            case "disconnect":
            case "staleConnection":
              update("disconnected");
              break;
            case "reconnecting":
              update("reconnecting");
              break;
            case "reconnect":
            case "connect":
              update("connected");
              break;
            case "error":
              update("error");
              break;
            case "closed":
              update("closed");
              break;
          }
        }
      } catch {}
    })();

    // track close
    nc.closed().then((err) => {
      if (err) {
        try { trace(`nc closed with error: ${err?.message || err}\n`); } catch {}
      }
      update("closed");
    });

    // Optional demo subscription
    try {
      const sub = await nc.subscribe("demo.>");
      (async () => {
        for await (const m of sub) {
          try { trace(`recv [${m.subject}]: ${m.string()}\n`); } catch {}
        }
      })();
    } catch {}
  } catch (e) {
    try { trace(`connect failed: ${e?.message || e}\n`); } catch {}
    update("error");
  }
}
