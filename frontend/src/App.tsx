import { useCallback, useEffect, useState } from "react";
import { listScenarios, getScenario, saveScenario, comfyStatus, outScenario, me, logout, type Engine, type AuthUser, type RegenSpec } from "./api";
import type { Scenario, ScenarioInfo, ComfyStatus, AssetKind } from "./types";
import ScenarioEditor from "./components/ScenarioEditor";
import RunPanel from "./components/RunPanel";
import OutputGallery from "./components/OutputGallery";
import CraftPanel from "./components/CraftPanel";
import Login from "./components/Login";
import { IconClapper, IconFolder, IconLogOut, IconMoon, IconSun, Spinner } from "./components/Icons";

export type Theme = "dark" | "light";

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("ss-theme") === "light" ? "light" : "dark"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ss-theme", theme);
  }, [theme]);

  useEffect(() => {
    me()
      .then((r) => setAuth(r))
      .catch(() => setAuth(null))
      .finally(() => setChecking(false));
  }, []);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const handleLogout = () => {
    logout().catch(() => {});
    setAuth(null);
  };

  if (checking) {
    return (
      <div className="login-screen">
        <div className="login-bg" aria-hidden="true" />
        <div className="login-checking"><Spinner size={18} /></div>
      </div>
    );
  }

  if (!auth) return <Login onAuthed={setAuth} />;

  return (
    <Studio
      user={auth.user}
      onLogout={handleLogout}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

function Studio({ user, onLogout, theme, onToggleTheme }: {
  user: string;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<Scenario | null>(null);
  const [draft, setDraft] = useState<{ name: string; config: Scenario } | null>(null);
  const [engine, setEngine] = useState<Engine>("ltx");
  const [comfy, setComfy] = useState<ComfyStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [runActive, setRunActive] = useState(false);
  const [pendingRun, setPendingRun] = useState<{ nonce: number; stitch?: boolean; regen?: RegenSpec | null } | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const refreshScenarios = useCallback(async () => {
    const all = await listScenarios();
    setScenarios(all.filter((s) => s.isSequence));
  }, []);

  useEffect(() => {
    refreshScenarios().then(() => {});
  }, [refreshScenarios]);

  useEffect(() => {
    if (!name) return;
    getScenario(name).then((r) => setCfg(r.config));
  }, [name]);

  useEffect(() => {
    comfyStatus().then(setComfy);
    const t = setInterval(() => comfyStatus().then(setComfy), 15000);
    return () => clearInterval(t);
  }, []);

  const handleSave = async (c: Scenario) => {
    const target = draft ? draft.name : name;
    await saveScenario(target, c);
    if (draft) {
      await refreshScenarios();
      setName(target);
      setDraft(null);
    }
  };

  const editor = draft
    ? { name: draft.name, config: draft.config }
    : cfg ? { name, config: cfg } : null;

  const comfyQueue = comfy?.queue
    ? (comfy.queue.queue_running?.length ?? 0) + (comfy.queue.queue_pending?.length ?? 0)
    : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <IconClapper size={17} />
          </span>
          <span className="brand-name">Sequence Studio</span>
          <span className="brand-sub">ComfyUI character-sequence pipeline</span>
        </div>
        <div className="topbar-right">
          <span className={`pill ${comfy?.up ? "ok" : "err"}`} title={comfy?.error ?? ""}>
            <span className={`dot ${comfy?.up ? "pulse" : ""}`} />
            {comfy?.up
              ? `ComfyUI online${comfyQueue > 0 ? ` · ${comfyQueue} queued` : ""}`
              : "ComfyUI offline"}
          </span>
          <button
            className="icon-btn theme-toggle"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
          <div className="user-chip" title={`Signed in as ${user}`}>
            <span className="user-avatar">{user.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{user}</span>
            <button className="icon-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">
              <IconLogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>Scenarios</span>
            <span className="muted" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
              {scenarios.length}
            </span>
          </div>
          <div className="sidebar-list">
            {scenarios.length === 0 && (
              <div className="sidebar-empty">
                No scenarios yet — craft one with the LLM.
              </div>
            )}
            {scenarios.map((s) => (
              <button
                key={s.name}
                className={`scenario-item ${!draft && name === s.name ? "on" : ""}`}
                onClick={() => { setDraft(null); setName(s.name); }}
              >
                <span className="scenario-name">{s.name}</span>
                <span className="scenario-file">.json</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="col">
          <CraftPanel onCrafted={(n, c) => setDraft({ name: n, config: c })} />
          {editor ? (
            <ScenarioEditor
              key={editor.name}
              name={editor.name}
              config={editor.config}
              isDraft={!!draft}
              onSave={handleSave}
            />
          ) : (
            <section className="card">
              <div className="empty">
                <span className="empty-icon">
                  <IconFolder size={20} />
                </span>
                <span className="empty-title">No scenario selected</span>
                <span className="empty-sub">
                  Pick a scenario from the list, or craft a new one above.
                </span>
              </div>
            </section>
          )}
          <RunPanel
            scenario={draft ? "" : name}
            engine={engine}
            onEngine={setEngine}
            onDone={refresh}
            onStatus={(s) => setRunActive(s === "running")}
            pendingRun={pendingRun}
          />
        </div>

        <div className="col">
          <OutputGallery
            scenario={outScenario(draft ? draft.name : name, engine)}
            refreshKey={refreshKey}
            onStitch={() => !runActive && setPendingRun({ nonce: Date.now(), stitch: true })}
            onRegen={(kind: AssetKind, index: number | null) =>
              !runActive && setPendingRun({ nonce: Date.now(), regen: { kind, index: index ?? undefined } })}
          />
        </div>
      </div>
    </div>
  );
}
