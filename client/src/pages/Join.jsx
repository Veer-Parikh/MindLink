import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { Logo, PageLoader } from "../components/ui/index.jsx";

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api("/projects/join", { method: "POST", body: { code } })
      .then(({ projectId, alreadyMember }) => {
        if (!alreadyMember) toast.success("You're in! Say hi to the team 👋");
        navigate(`/p/${projectId}`, { replace: true });
      })
      .catch((err) => setError(err.message));
  }, [code, navigate]);

  if (!error) return <PageLoader label="Joining project…" />;
  return (
    <div className="center-page">
      <div className="grid-bg" />
      <Logo />
      <h2>That invite didn’t work</h2>
      <p className="muted">{error} Invite codes change when an owner regenerates them.</p>
      <Link to="/app" className="btn btn-primary">
        Go to your projects
      </Link>
    </div>
  );
}
