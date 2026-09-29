import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "./lib/auth.jsx";
import { PageLoader, TooltipLayer } from "./components/ui/index.jsx";
import Landing from "./pages/Landing.jsx";
import AuthPage from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import JoinPage from "./pages/Join.jsx";
import NotFound from "./pages/NotFound.jsx";

// The workspace pulls in Monaco — load it only when someone opens a project.
const Workspace = lazy(() => import("./pages/Workspace.jsx"));

function RequireAuth({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function GuestOnly({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <PageLoader />;
  if (user) return <Navigate to={location.state?.from ?? "/app"} replace />;
  return children;
}

export default function App() {
  const { user, status } = useAuth();
  return (
    <>
      <Routes>
        <Route path="/" element={status === "ready" && user ? <Navigate to="/app" replace /> : <Landing />} />
        <Route
          path="/login"
          element={
            <GuestOnly>
              <AuthPage mode="login" />
            </GuestOnly>
          }
        />
        <Route
          path="/signup"
          element={
            <GuestOnly>
              <AuthPage mode="signup" />
            </GuestOnly>
          }
        />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/join/:code"
          element={
            <RequireAuth>
              <JoinPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId"
          element={
            <RequireAuth>
              <Suspense fallback={<PageLoader label="Opening workspace…" />}>
                <Workspace />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster theme="dark" position="top-right" offset={{ top: 64, right: 16 }} closeButton />
      <TooltipLayer />
    </>
  );
}
