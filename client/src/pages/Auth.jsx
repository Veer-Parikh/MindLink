import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, History, Lock, Mail, Sparkles, User, Users } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { Logo, Spinner } from "../components/ui/index.jsx";

export default function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      navigate(location.state?.from ?? "/app", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-aside-glow" />
        <Link to="/">
          <Logo />
        </Link>
        <div className="auth-aside-body">
          <h2>
            The editor that <span className="grad-text">remembers everything</span> your team builds.
          </h2>
          <ul>
            <li>
              <span>
                <Users size={16} />
              </span>
              Edit together with live, named cursors
            </li>
            <li>
              <span>
                <History size={16} />
              </span>
              Scrub back through every change with Rewind
            </li>
            <li>
              <span>
                <Sparkles size={16} />
              </span>
              Catch up on what changed while you were away
            </li>
          </ul>
        </div>
        <div className="auth-aside-quote">
          “We used to lose our best ideas between commits. Now we just rewind.”
          <span>— every hackathon team, around 3am</span>
        </div>
      </aside>

      <main className="auth-main">
        <motion.form
          key={mode}
          className="auth-card"
          onSubmit={submit}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="auth-mobile-logo">
            <Logo />
          </div>
          <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
          <p className="muted">
            {isSignup ? "It takes ten seconds. No credit card, no install." : "Sign in to jump back into your projects."}
          </p>

          {isSignup && (
            <label className="field">
              <span className="field-label">Name</span>
              <div className="input-with-icon">
                <User />
                <input
                  className="input"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={40}
                  autoFocus
                />
              </div>
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <div className="input-with-icon">
              <Mail />
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="you@team.dev"
                autoComplete="email"
                required
                autoFocus={!isSignup}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <div className="input-with-icon">
              <Lock />
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={set("password")}
                placeholder={isSignup ? "At least 6 characters" : "••••••••"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
                minLength={isSignup ? 6 : undefined}
              />
            </div>
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="btn btn-gradient btn-lg btn-block" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                {isSignup ? "Create account" : "Sign in"} <ArrowRight />
              </>
            )}
          </button>

          <p className="auth-switch">
            {isSignup ? "Already have an account?" : "New to MindLink?"}{" "}
            <Link to={isSignup ? "/login" : "/signup"} state={location.state}>
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </motion.form>
      </main>
    </div>
  );
}
