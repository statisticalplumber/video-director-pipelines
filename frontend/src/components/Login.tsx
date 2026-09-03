import { useState, type FormEvent } from "react";
import { login } from "../api";
import type { AuthUser } from "../types";
import { IconClapper, IconEye, IconEyeOff, IconAlert, IconLock, IconUser, Spinner } from "./Icons";

export default function Login({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onAuthed(await login(username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
      setShake((s) => s + 1);
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-bg" aria-hidden="true" />
      <form
        key={shake}
        className={`login-card ${shake ? "shake" : ""}`}
        onSubmit={submit}
        onAnimationEnd={() => setShake(0)}
      >
        <div className="login-brand">
          <span className="brand-mark login-mark">
            <IconClapper size={22} />
          </span>
          <span className="login-title">Sequence Studio</span>
          <span className="login-sub">ComfyUI character-sequence pipeline</span>
        </div>

        <h1 className="login-h1">Sign in</h1>
        <p className="login-desc">Enter your credentials to open the studio.</p>

        <div className="login-field">
          <label htmlFor="login-user">Username</label>
          <div className="login-input">
            <IconUser size={15} className="login-input-icon" />
            <input
              id="login-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
        </div>

        <div className="login-field">
          <label htmlFor="login-pass">Password</label>
          <div className="login-input">
            <IconLock size={15} className="login-input-icon" />
            <input
              id="login-pass"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="icon-btn login-eye"
              onClick={() => setShow((s) => !s)}
              title={show ? "Hide password" : "Show password"}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="login-error">
            <IconAlert size={14} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="primary login-submit" disabled={busy}>
          {busy ? <Spinner size={14} /> : <IconLock size={14} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="login-hint">
          Credentials are configured in <code>video_test/.env</code> via{" "}
          <code>LOGIN_USER</code> / <code>LOGIN_PASS</code>.
        </p>
      </form>
    </div>
  );
}
