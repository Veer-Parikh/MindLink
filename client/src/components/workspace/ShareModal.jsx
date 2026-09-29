import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2, RefreshCw, Share2, UserMinus } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { Avatar, Modal } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

function CopyField({ value, label, mono }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <input
        className={`input ${mono ? "input-mono" : ""}`}
        value={value}
        readOnly
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <button
        className="btn"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function ShareModal({ open, onClose }) {
  const { project, setProject, user, peers, loadProject } = useWorkspace();

  // Refresh the member list every time the dialog opens.
  useEffect(() => {
    if (open) loadProject();
  }, [open, loadProject]);
  const isOwner = project.role === "owner";
  const onlineIds = new Set(peers.map((p) => p.user.id));
  onlineIds.add(user.id);
  const link = project.inviteCode ? `${window.location.origin}/join/${project.inviteCode}` : null;

  async function regenerate() {
    if (!window.confirm("Create a new invite code? The old link will stop working.")) return;
    try {
      const { inviteCode } = await api(`/projects/${project.id}/invite/regenerate`, { method: "POST" });
      setProject((p) => ({ ...p, inviteCode }));
      toast.success("New invite code created");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setRole(memberId, role) {
    try {
      const { members } = await api(`/projects/${project.id}/members/${memberId}`, { method: "PATCH", body: { role } });
      setProject((p) => ({ ...p, members }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(member) {
    if (!window.confirm(`Remove ${member.name} from this project?`)) return;
    try {
      await api(`/projects/${project.id}/members/${member.id}`, { method: "DELETE" });
      setProject((p) => ({ ...p, members: p.members.filter((m) => m.id !== member.id) }));
      toast.success(`${member.name} was removed`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Share2 />}
      title="Invite your team"
      description="Anyone with the link joins as an editor. You can make people read-only below."
    >
      <div className="modal-body">
        {link ? (
          <>
            <div className="field">
              <span className="field-label">
                <Link2 size={13} /> Invite link
              </span>
              <CopyField value={link} label="Invite link" />
            </div>
            <div className="field">
              <span className="field-label">Or share the code</span>
              <div className="invite-code-row">
                <span className="invite-code">{project.inviteCode}</span>
                {isOwner && (
                  <button className="btn btn-ghost btn-sm" onClick={regenerate}>
                    <RefreshCw /> New code
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">Viewers can’t see the invite code. Ask an editor or the owner to invite people.</p>
        )}

        <div className="field">
          <span className="field-label">People with access · {project.members.length}</span>
          <ul className="member-list">
            {project.members.map((m) => (
              <li key={m.id}>
                <Avatar user={m} size={32} online={onlineIds.has(m.id)} />
                <div className="member-info">
                  <strong>
                    {m.name} {m.id === user.id && <span className="muted">(you)</span>}
                  </strong>
                  <span className="muted">
                    {onlineIds.has(m.id) ? "Online now" : m.lastSeenAt ? `Last seen ${timeAgo(m.lastSeenAt)}` : m.email}
                  </span>
                </div>
                {isOwner && m.role !== "owner" ? (
                  <div className="member-controls">
                    <select
                      className="select input-sm"
                      value={m.role}
                      onChange={(e) => setRole(m.id, e.target.value)}
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button className="icon-btn sm" onClick={() => remove(m)} data-tip="Remove">
                      <UserMinus />
                    </button>
                  </div>
                ) : (
                  <span className={`pc-role-inline role-${m.role}`}>{m.role}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
