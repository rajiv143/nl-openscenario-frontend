import { useState, useEffect, useRef } from "react";

// ---- Point this at your FastAPI backend ----
const API_URL = "https://nl-openscenario-api.onrender.com";
// --------------------------------------------

const EXAMPLES = [
  "A pedestrian suddenly jaywalks across the road on a rainy night",
  "A vehicle cuts in aggressively from the right lane during heavy traffic",
  "A child runs out from behind a parked car near a school zone",
  "Emergency ambulance approaching from behind on a wet highway",
  "A cyclist overtakes on a narrow street while a delivery truck is stopped",
  "Two vehicles approach a blind intersection at the same time in fog",
];

const LOADING_PHASES = [
  { after: 0, msg: "Sending request to backend...", sub: "" },
  { after: 3, msg: "Calling the LLM inference endpoint...", sub: "" },
  { after: 8, msg: "Model is waking up...", sub: "The GPU endpoint scales to zero when idle. First request takes 1-3 minutes." },
  { after: 20, msg: "Still warming up the model...", sub: "Loading Llama 3.2 3B weights onto the GPU. This only happens on the first request." },
  { after: 45, msg: "Almost there...", sub: "vLLM is compiling CUDA graphs. Subsequent requests will be fast." },
  { after: 90, msg: "Hang tight, model is still initializing...", sub: "Cold starts can take up to 3 minutes. This is a one-time wait." },
  { after: 150, msg: "This is taking longer than usual...", sub: "The endpoint may be experiencing high load. Feel free to wait or retry." },
];

function StatusPill({ label, value }) {
  return (
    <div style={{
      padding: "6px 12px", background: "#0c0c14", borderRadius: 6,
      border: "1px solid #1e1e30", display: "inline-flex", gap: 8, alignItems: "center",
    }}>
      <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 12, color: "#ccc", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function LoadingState({ elapsed }) {
  // Find the current phase based on elapsed seconds
  let phase = LOADING_PHASES[0];
  for (let i = LOADING_PHASES.length - 1; i >= 0; i--) {
    if (elapsed >= LOADING_PHASES[i].after) {
      phase = LOADING_PHASES[i];
      break;
    }
  }

  const isColdStart = elapsed >= 8;
  const progress = Math.min(95, (elapsed / 180) * 100);

  return (
    <div style={{
      marginTop: 24, padding: "28px 24px", textAlign: "center",
      background: "#0c0c14", border: "1px solid #161624", borderRadius: 10,
    }}>
      {/* Spinner */}
      <div style={{
        width: 28, height: 28,
        border: "2.5px solid #1c1c2c",
        borderTopColor: "#e85d04",
        borderRadius: "50%",
        margin: "0 auto 18px",
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Main message */}
      <p style={{
        margin: 0, fontSize: 13, color: "#bbb", fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
      }}>{phase.msg}</p>

      {/* Sub message */}
      {phase.sub && (
        <p style={{
          margin: "6px auto 0", fontSize: 11, color: "#555",
          maxWidth: 420, lineHeight: 1.5,
        }}>{phase.sub}</p>
      )}

      {/* Progress bar (shows after cold start detected) */}
      {isColdStart && (
        <div style={{
          marginTop: 16, maxWidth: 300, marginLeft: "auto", marginRight: "auto",
        }}>
          <div style={{
            height: 3, background: "#161624", borderRadius: 2, overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, #e85d04, #dc2626)",
              borderRadius: 2,
              transition: "width 1s linear",
            }} />
          </div>
          <p style={{
            margin: "6px 0 0", fontSize: 10, color: "#333",
            fontFamily: "'IBM Plex Mono', monospace",
          }}>{Math.floor(elapsed)}s elapsed</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("json");
  const [copied, setCopied] = useState("");
  const timerRef = useRef(null);

  // Elapsed time counter during loading
  useEffect(() => {
    if (loading) {
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [loading]);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const MAX_RETRIES = 2;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${API_URL}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });

        if (res.status === 503) {
          // HF endpoint is cold-starting, wait and retry
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 15000)); // wait 15s
            continue;
          }
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          const detail = err.detail || `Server error ${res.status}`;

          // Friendly message for cold start errors
          if (detail.includes("503") || detail.includes("Service Unavailable")) {
            throw new Error(
              "The AI model is still waking up. Please wait 1-2 minutes and try again. " +
              "The GPU scales to zero when idle to save costs."
            );
          }
          throw new Error(detail);
        }

        const data = await res.json();
        setResult(data);
        setTab("json");
        setLoading(false);
        return; // Success, exit
      } catch (e) {
        lastError = e;
        if (attempt < MAX_RETRIES && (e.message.includes("503") || e.message.includes("fetch"))) {
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
      }
    }

    setError(lastError?.message || "Unknown error");
    setLoading(false);
  };

  const download = (content, filename, mime = "application/json") => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
  };

  const copy = async (text, label) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  const scenario = result?.json_scenario;
  const name = scenario?.scenario_name || "scenario";

  return (
    <div style={{ minHeight: "100vh", background: "#08080d", fontFamily: "'IBM Plex Mono', 'Menlo', monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* NAV */}
      <nav style={{
        padding: "14px 0", borderBottom: "1px solid #141420",
        background: "linear-gradient(180deg, #0a0a12 0%, #08080d 100%)",
      }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: "linear-gradient(135deg, #e85d04, #dc2626)",
              display: "grid", placeItems: "center",
              fontSize: 13, fontWeight: 700, color: "#fff",
              fontFamily: "'DM Sans', sans-serif",
            }}>N</div>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 15, color: "#e8e8f0", letterSpacing: "-0.03em" }}>
              NL-OpenScenario
            </span>
          </div>
          <span style={{ fontSize: 10, color: "#3a3a50", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Llama 3.2 3B + CARLA
          </span>
        </div>
      </nav>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "36px 20px" }}>
        {/* HERO */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 28, fontWeight: 700,
            color: "#f0f0f8", margin: "0 0 6px", letterSpacing: "-0.04em", lineHeight: 1.2,
          }}>
            Describe a driving scenario.
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#4a4a60", lineHeight: 1.5 }}>
            Get a CARLA-ready JSON scenario and OpenSCENARIO XOSC file, generated by a fine-tuned LLM.
          </p>
        </div>

        {/* INPUT */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
            placeholder="e.g. A pedestrian suddenly crosses during heavy rain at night while a truck is parked on the shoulder..."
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box", padding: "14px 16px",
              fontSize: 13, lineHeight: 1.65, color: "#d0d0dc",
              background: "#0e0e16", border: "1px solid #1c1c2c", borderRadius: 8,
              fontFamily: "'IBM Plex Mono', monospace", resize: "vertical", outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={e => e.target.style.borderColor = "#e85d04"}
            onBlur={e => e.target.style.borderColor = "#1c1c2c"}
          />
        </div>

        {/* EXAMPLES */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setPrompt(ex)} style={{
              padding: "3px 9px", fontSize: 10, background: "#0e0e16",
              border: "1px solid #1c1c2c", borderRadius: 14, color: "#5a5a70",
              cursor: "pointer", transition: "all 0.12s", lineHeight: 1.5,
            }}
            onMouseEnter={e => { e.target.style.borderColor = "#e85d04"; e.target.style.color = "#aaa"; }}
            onMouseLeave={e => { e.target.style.borderColor = "#1c1c2c"; e.target.style.color = "#5a5a70"; }}
            >
              {ex.length > 55 ? ex.slice(0, 55) + "..." : ex}
            </button>
          ))}
        </div>

        {/* GENERATE BUTTON */}
        <button onClick={generate} disabled={loading || !prompt.trim()} style={{
          padding: "10px 24px", fontSize: 13, fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
          background: loading ? "#252530" : "linear-gradient(135deg, #e85d04, #dc2626)",
          border: "none", borderRadius: 6, color: "#fff",
          cursor: loading ? "wait" : "pointer",
          opacity: !prompt.trim() ? 0.35 : 1,
          transition: "all 0.15s", letterSpacing: "-0.01em",
        }}>
          {loading ? "Generating..." : "Generate Scenario"}
        </button>
        {!loading && <span style={{ fontSize: 10, color: "#333", marginLeft: 10 }}>Ctrl+Enter</span>}

        {/* LOADING */}
        {loading && <LoadingState elapsed={elapsed} />}

        {/* ERROR */}
        {error && (
          <div style={{
            marginTop: 20, padding: "14px 18px", fontSize: 12, lineHeight: 1.7,
            background: "#140a0a", border: "1px solid #2e1212", borderRadius: 8, color: "#f87171",
          }}>
            {error}
            {error.includes("waking up") && (
              <div style={{ marginTop: 10 }}>
                <button onClick={generate} style={{
                  padding: "7px 16px", fontSize: 11, fontWeight: 500,
                  background: "#e85d04", border: "none", borderRadius: 5,
                  color: "#fff", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                }}>
                  Retry Now
                </button>
              </div>
            )}
          </div>
        )}

        {/* RESULTS */}
        {result && (
          <div style={{
            marginTop: 24, background: "#0c0c14",
            border: "1px solid #161624", borderRadius: 10, overflow: "hidden",
          }}>
            {/* Header row */}
            <div style={{
              padding: "14px 18px", borderBottom: "1px solid #161624",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10,
            }}>
              <div>
                <h2 style={{
                  margin: 0, fontSize: 15, fontWeight: 600, color: "#eee",
                  fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em",
                }}>{scenario?.scenario_name || "Generated Scenario"}</h2>
                {scenario?.description && (
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#555" }}>{scenario.description}</p>
                )}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {scenario?.weather && <StatusPill label="weather" value={scenario.weather} />}
                {scenario?.map_name && <StatusPill label="map" value={scenario.map_name} />}
                <StatusPill label="actors" value={scenario?.actors?.length || 0} />
                <StatusPill label="actions" value={scenario?.actions?.length || 0} />
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #161624" }}>
              {[
                { id: "json", label: "JSON" },
                { id: "xosc", label: "XOSC" },
                { id: "details", label: "Details" },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "9px 18px", fontSize: 11, fontWeight: 500,
                  background: "transparent", border: "none",
                  borderBottom: tab === t.id ? "2px solid #e85d04" : "2px solid transparent",
                  color: tab === t.id ? "#ddd" : "#444",
                  cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ padding: 18 }}>
              {tab === "json" && (
                <pre style={{
                  margin: 0, padding: 14, background: "#08080d", borderRadius: 6,
                  fontSize: 11, lineHeight: 1.7, color: "#8888a0",
                  maxHeight: 450, overflow: "auto", whiteSpace: "pre-wrap",
                  border: "1px solid #12121e",
                }}>{JSON.stringify(scenario, null, 2)}</pre>
              )}

              {tab === "xosc" && (
                <pre style={{
                  margin: 0, padding: 14, background: "#08080d", borderRadius: 6,
                  fontSize: 11, lineHeight: 1.7, color: "#8888a0",
                  maxHeight: 450, overflow: "auto", whiteSpace: "pre-wrap",
                  border: "1px solid #12121e",
                }}>{result.xosc}</pre>
              )}

              {tab === "details" && (
                <div style={{ fontSize: 12, color: "#888", lineHeight: 2 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "4px 14px" }}>
                    <span style={{ color: "#555" }}>Ego Vehicle</span>
                    <span style={{ color: "#bbb" }}>{scenario?.ego_vehicle_model || "N/A"}</span>
                    <span style={{ color: "#555" }}>Ego Speed</span>
                    <span style={{ color: "#bbb" }}>{scenario?.ego_start_speed != null ? `${scenario.ego_start_speed} m/s` : "N/A"}</span>
                    <span style={{ color: "#555" }}>Timeout</span>
                    <span style={{ color: "#bbb" }}>{scenario?.timeout ? `${scenario.timeout}s` : "N/A"}</span>
                    <span style={{ color: "#555" }}>Collision</span>
                    <span style={{ color: "#bbb" }}>{scenario?.collision_allowed === false ? "Not allowed" : scenario?.collision_allowed === true ? "Allowed" : "N/A"}</span>
                    <span style={{ color: "#555" }}>Success Dist.</span>
                    <span style={{ color: "#bbb" }}>{scenario?.success_distance ? `${scenario.success_distance}m` : "N/A"}</span>
                  </div>

                  {scenario?.actors?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Actors</div>
                      {scenario.actors.map((a, i) => (
                        <div key={i} style={{
                          padding: "8px 12px", background: "#08080d", borderRadius: 6,
                          marginBottom: 4, fontSize: 11, border: "1px solid #12121e",
                          display: "flex", gap: 10, alignItems: "center",
                        }}>
                          <span style={{ color: "#e85d04", fontWeight: 600, minWidth: 100 }}>{a.id}</span>
                          <span style={{ color: "#555" }}>{a.type}</span>
                          <span style={{ color: "#777" }}>{a.model}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {scenario?.actions?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Actions</div>
                      {scenario.actions.map((a, i) => (
                        <div key={i} style={{
                          padding: "8px 12px", background: "#08080d", borderRadius: 6,
                          marginBottom: 4, fontSize: 11, border: "1px solid #12121e",
                          display: "flex", gap: 10, alignItems: "center",
                        }}>
                          <span style={{ color: "#e85d04", minWidth: 100 }}>{a.actor_id}</span>
                          <span style={{ color: "#777" }}>{a.action_type}</span>
                          <span style={{ color: "#555" }}>trigger: {a.trigger_type} @ {a.trigger_value}</span>
                          {a.speed_value != null && <span style={{ color: "#555" }}>{a.speed_value} m/s</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Download bar */}
            <div style={{
              padding: "12px 18px", borderTop: "1px solid #161624",
              display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
            }}>
              <button onClick={() => download(JSON.stringify(scenario, null, 2), `${name}.json`)} style={{
                padding: "7px 14px", fontSize: 11, fontWeight: 500,
                background: "#e85d04", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                Download .json
              </button>
              <button onClick={() => download(result.xosc, `${name}.xosc`, "application/xml")} style={{
                padding: "7px 14px", fontSize: 11, fontWeight: 500,
                background: "#dc2626", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                Download .xosc
              </button>
              <button onClick={() => copy(JSON.stringify(scenario, null, 2), "json")} style={{
                padding: "7px 14px", fontSize: 11,
                background: "transparent", border: "1px solid #1c1c2c", borderRadius: 5,
                color: "#666", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {copied === "json" ? "Copied!" : "Copy JSON"}
              </button>
              <button onClick={() => copy(result.xosc, "xosc")} style={{
                padding: "7px 14px", fontSize: 11,
                background: "transparent", border: "1px solid #1c1c2c", borderRadius: 5,
                color: "#666", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {copied === "xosc" ? "Copied!" : "Copy XOSC"}
              </button>
            </div>
          </div>
        )}

        {/* FOOTER */}
        <footer style={{
          marginTop: 48, paddingTop: 18, borderTop: "1px solid #111118",
          fontSize: 10, color: "#2a2a3a", lineHeight: 1.8,
        }}>
          <p style={{ margin: 0 }}>Powered by a LoRA fine-tuned Llama 3.2 3B Instruct model trained on 200+ CARLA scenario pairs.</p>
          <p style={{ margin: "2px 0 0" }}>Run generated .xosc files in CARLA: <code style={{ color: "#3a3a4a" }}>./scenario_runner.py --openscenario scenario.xosc --reloadWorld</code></p>
        </footer>
      </main>
    </div>
  );
}
