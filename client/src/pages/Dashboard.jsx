import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  Check,
  Copy as CopyIcon,
  FolderPlus,
  GitFork,
  History,
  KeyRound,
  LogIn,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { greeting, timeAgo } from "../lib/format.js";
import { TEMPLATE_META } from "../lib/languages.js";
import { anchorBelow, Avatar, AvatarStack, EmptyState, Logo, Menu, Modal, Spinner } from "../components/ui/index.jsx";

const COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#fb923c", "#4ade80", "#facc15", "#60a5fa", "#f87171", "#2dd4bf", "#c084fc"];

function TemplateGlyph({ template, size = 40 }) {
  const meta = TEMPLATE_META[template] ?? TEMPLATE_META.blank;
  return (
    <span className="template-glyph" style={{ "--c": meta.color, width: size, height: size, fontSize: size * 0.34 }}>
      {meta.glyph}
    </span>
  );
}

function CreateProjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("web");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setTemplate("web");
      setBusy(false);
    }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { project } = await api("/projects", { method: "POST", body: { name, description, template } });
      onCreated(project);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Pick a starting point. You can add any files later."
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="template-grid">
            {Object.entries(TEMPLATE_META).map(([key, meta]) => (
              <button
                type="button"
                key={key}
                className={`template-tile ${template === key ? "is-selected" : ""}`}
                onClick={() => setTemplate(key)}
              >
                <TemplateGlyph template={key} size={36} />
                <strong>{meta.label}</strong>
                <span>{meta.hint}</span>
                {template === key && (
                  <span className="template-check">
                    <Check size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field-label">Project name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hackathon MVP"
              required
              maxLength={60}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">
              Description <span className="muted">(optional)</span>
            </span>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you building?"
              maxLength={280}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : <FolderPlus />} Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JoinModal({ open, onClose }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setCode("");
      setBusy(false);
    }
  }, [open]);

  const format = (value) => {
    const clean = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { projectId } = await api("/projects/join", { method: "POST", body: { code } });
      navigate(`/p/${projectId}`);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Join a project" description="Paste the invite code a teammate shared with you.">
      <form onSubmit={submit}>
        <div className="modal-body">
          <input
            className="input input-mono join-code-input"
            value={code}
            onChange={(e) => setCode(format(e.target.value))}
            placeholder="ABCD-1234"
            autoFocus
            aria-label="Invite code"
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || code.length < 9}>
            {busy ? <Spinner /> : <LogIn />} Join
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileModal({ open, onClose }) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [color, setColor] = useState(user.color);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user.name);
      setColor(user.color);
    }
  }, [open, user]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ name, color });
      toast.success("Profile updated");
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your profile"
      description="This is how teammates see you: your name labels your cursor."
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="profile-preview">
            <Avatar user={{ name: name || "?", color }} size={52} />
            <span className="profile-caret" style={{ "--c": color }} data-name={name || "?"} />
          </div>
          <label className="field">
            <span className="field-label">Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          </label>
          <div className="field">
            <span className="field-label">Cursor colour</span>
            <div className="color-row">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`color-swatch ${color === c ? "is-selected" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Check />} Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectCard({ project, onOpen, onChanged, userId }) {
  const [menu, setMenu] = useState(null);
  const navigate = useNavigate();
  const meta = TEMPLATE_META[project.template] ?? TEMPLATE_META.blank;
  const isOwner = project.role === "owner";

  async function fork() {
    try {
      const { projectId } = await api(`/projects/${project.id}/duplicate`, { method: "POST", body: {} });
      toast.success(`Forked “${project.name}”`);
      navigate(`/p/${projectId}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove() {
    const question = isOwner
      ? `Delete “${project.name}” for everyone? This can't be undone.`
      : `Leave “${project.name}”? You'll need a new invite to come back.`;
    if (!window.confirm(question)) return;
    try {
      if (isOwner) await api(`/projects/${project.id}`, { method: "DELETE" });
      else await api(`/projects/${project.id}/members/${userId}`, { method: "DELETE" });
      toast.success(isOwner ? "Project deleted" : "You left the project");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <motion.article
      layout
      className="project-card"
      style={{ "--c": meta.color }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <div className="pc-top">
        <TemplateGlyph template={project.template} />
        <div className="pc-title">
          <h3>{project.name}</h3>
          <span className="muted">{meta.label}</span>
        </div>
        <button
          className="icon-btn"
          aria-label="Project actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(anchorBelow(e, "right"));
          }}
        >
          <MoreHorizontal />
        </button>
      </div>
      <p className="pc-desc">{project.description || <span className="muted">No description</span>}</p>
      <div className="pc-foot">
        <AvatarStack users={project.members} size={24} />
        <div className="pc-stats">
          <span data-tip="Snapshots on the Rewind timeline">
            <History size={13} /> {project.snapshotCount}
          </span>
          <span>{timeAgo(project.updatedAt)}</span>
        </div>
      </div>
      {project.role !== "owner" && <span className={`pc-role role-${project.role}`}>{project.role}</span>}
      <Menu
        open={Boolean(menu)}
        at={menu}
        align="right"
        onClose={() => setMenu(null)}
        items={[
          { label: "Open", icon: LogIn, onClick: onOpen },
          { label: "Fork a copy", icon: GitFork, onClick: fork },
          "sep",
          isOwner
            ? { label: "Delete project", icon: Trash2, danger: true, onClick: remove }
            : { label: "Leave project", icon: LogOut, danger: true, onClick: remove },
        ]}
      />
    </motion.article>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [userMenu, setUserMenu] = useState(null);

  const load = () =>
    api("/projects")
      .then(({ projects }) => setProjects(projects))
      .catch((err) => {
        toast.error(err.message);
        setProjects([]);
      });

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => `${p.name} ${p.description} ${p.template}`.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="dashboard">
      <div className="grid-bg subtle" />
      <header className="dash-nav">
        <Link to="/app">
          <Logo />
        </Link>
        <div className="dash-nav-right">
          <button className="user-chip" onClick={(e) => setUserMenu(anchorBelow(e, "right"))}>
            <Avatar user={user} size={28} />
            <span>{user.name}</span>
          </button>
        </div>
        <Menu
          open={Boolean(userMenu)}
          at={userMenu}
          align="right"
          onClose={() => setUserMenu(null)}
          items={[
            { label: "Profile & cursor colour", icon: UserRound, onClick: () => setModal("profile") },
            { label: "Copy my email", icon: CopyIcon, onClick: () => navigator.clipboard?.writeText(user.email) },
            "sep",
            { label: "Sign out", icon: LogOut, onClick: logout },
          ]}
        />
      </header>

      <main className="dash-main">
        <section className="dash-hero">
          <div>
            <h1>
              {greeting()}, <span className="grad-text">{user.name.split(" ")[0]}</span>
            </h1>
            <p className="muted">
              {projects === null
                ? "Loading your projects…"
                : projects.length
                  ? `You're in ${projects.length} project${projects.length === 1 ? "" : "s"}. Pick up where you left off.`
                  : "Start something new, or join a teammate's project with an invite code."}
            </p>
          </div>
          <div className="dash-actions">
            <button className="btn" onClick={() => setModal("join")}>
              <KeyRound /> Join with code
            </button>
            <button className="btn btn-primary" onClick={() => setModal("create")}>
              <Plus /> New project
            </button>
          </div>
        </section>

        {projects && projects.length > 0 && (
          <div className="dash-toolbar">
            <div className="input-with-icon dash-search">
              <Search />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" />
            </div>
          </div>
        )}

        {projects === null ? (
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="project-card skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title="No projects yet"
            action={
              <button className="btn btn-gradient" onClick={() => setModal("create")}>
                <Plus /> Create your first project
              </button>
            }
          >
            Projects are shared rooms: everyone you invite edits the same files, live.
          </EmptyState>
        ) : (
          <div className="project-grid">
            <AnimatePresence>
              {filtered.map((p) => (
                <ProjectCard key={p.id} project={p} userId={user.id} onOpen={() => navigate(`/p/${p.id}`)} onChanged={load} />
              ))}
              <motion.button layout key="new" className="project-card new-card" onClick={() => setModal("create")}>
                <Plus />
                <span>New project</span>
              </motion.button>
            </AnimatePresence>
          </div>
        )}
      </main>

      <CreateProjectModal open={modal === "create"} onClose={() => setModal(null)} onCreated={(p) => navigate(`/p/${p.id}`)} />
      <JoinModal open={modal === "join"} onClose={() => setModal(null)} />
      <ProfileModal open={modal === "profile"} onClose={() => setModal(null)} />
    </div>
  );
}
