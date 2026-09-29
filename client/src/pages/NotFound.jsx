import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Logo } from "../components/ui/index.jsx";

export default function NotFound() {
  return (
    <div className="center-page">
      <div className="grid-bg" />
      <Logo />
      <h1 className="big-404 grad-text">404</h1>
      <p className="muted">This page wandered off. Maybe it’s in a different timeline.</p>
      <Link to="/" className="btn">
        <ArrowLeft /> Back home
      </Link>
    </div>
  );
}
