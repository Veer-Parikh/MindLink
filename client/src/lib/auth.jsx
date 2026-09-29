import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, onUnauthorized, tokenStore } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() => (tokenStore.get() ? "loading" : "ready"));
  const [meta, setMeta] = useState({ ai: false, remoteRun: false });

  useEffect(() => {
    api("/meta")
      .then(setMeta)
      .catch(() => {});
    if (!tokenStore.get()) return;
    api("/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => tokenStore.clear())
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        tokenStore.clear();
        setUser(null);
      }),
    [],
  );

  const finish = useCallback(({ token, user }) => {
    tokenStore.set(token);
    setUser(user);
    return user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      meta,
      login: (email, password) => api("/auth/login", { method: "POST", body: { email, password } }).then(finish),
      register: (name, email, password) =>
        api("/auth/register", { method: "POST", body: { name, email, password } }).then(finish),
      logout: () => {
        tokenStore.clear();
        setUser(null);
      },
      updateProfile: (patch) => api("/auth/me", { method: "PATCH", body: patch }).then(({ user }) => setUser(user)),
    }),
    [user, status, meta, finish],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
