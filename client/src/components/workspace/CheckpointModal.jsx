import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bookmark, Sparkles, Wand2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { Modal, Spinner } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

export default function CheckpointModal({ open, onClose }) {
  const { project, meta } = useWorkspace();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState(null);

  async function suggest({ auto = false } = {}) {
    setSuggesting(true);
    setNote(null);
    try {
      const res = await api(`/projects/${project.id}/ai/commit-message`, { method: "POST" });
      // An automatic suggestion never overwrites what the user already typed.
      if (res.message) setMessage((current) => (auto && current.trim() ? current : res.message));
      if (res.note) setNote(res.note);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    if (open) {
      setMessage("");
      setNote(null);
      setBusy(false);
      suggest({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/projects/${project.id}/checkpoints`, { method: "POST", body: { message } });
      toast.success("Checkpoint saved", { description: message });
      onClose();
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Bookmark />}
      title="Create a checkpoint"
      description="Name this moment so it’s easy to find on the Rewind timeline, like a commit that includes everyone’s work."
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="field">
            <span className="field-label">Message</span>
            <div className="checkpoint-input">
              <input
                className="input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={suggesting ? "Reading the changes…" : "e.g. Add login form validation"}
                maxLength={200}
                autoFocus
              />
              <button
                type="button"
                className="btn"
                onClick={() => suggest()}
                disabled={suggesting}
                data-tip={meta.ai ? "Write it from the diff with AI" : "Summarise the changed files"}
              >
                {suggesting ? <Spinner size={14} /> : meta.ai ? <Sparkles /> : <Wand2 />} Suggest
              </button>
            </div>
            <span className="field-hint">
              {note ??
                (meta.ai
                  ? "Suggestions are written by Pair from the changes since the last checkpoint."
                  : "Suggestions list the files changed since the last checkpoint.")}
            </span>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !message.trim()}>
            {busy ? <Spinner /> : <Bookmark />} Save checkpoint
          </button>
        </div>
      </form>
    </Modal>
  );
}
