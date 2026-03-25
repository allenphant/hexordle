import { useState, useEffect } from "react";
import { setupDiscordSdk, AuthData } from "./discordSdk";
import { Game } from "./components/Game";
import "./styles/index.css";

export function App() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setupDiscordSdk()
      .then(setAuth)
      .catch((err) => {
        console.error("Discord SDK setup failed:", err);
        setError(`Error: ${err?.message ?? String(err)}`);
      });
  }, []);

  if (error) {
    return (
      <div className="loading" style={{ flexDirection: "column", gap: "8px", fontSize: "0.8rem", padding: "16px", textAlign: "center" }}>
        <div>{error}</div>
        <div style={{ opacity: 0.6, wordBreak: "break-all" }}>URL: {window.location.href}</div>
        <div style={{ opacity: 0.6 }}>Params: {window.location.search || "(none)"}</div>
      </div>
    );
  }

  if (!auth) {
    return <div className="loading">Loading...</div>;
  }

  return <Game auth={auth} />;
}
