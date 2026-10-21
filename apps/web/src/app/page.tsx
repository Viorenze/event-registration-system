"use client";

import { useEffect, useState } from "react";

interface SessionData {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    expiresAt: string;
  };
}

export default function HomePage() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Sign up fields
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  // Sign in fields
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  const refreshSession = async () => {
    try {
      const res = await fetch("/api/auth/get-session", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: signUpName,
          email: signUpEmail,
          password: signUpPassword,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`Sign up failed: ${data.message || res.statusText}`);
      } else {
        setMessage("Sign up successful!");
        await refreshSession();
      }
    } catch (err) {
      setMessage(`Sign up error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: signInEmail,
          password: signInPassword,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`Sign in failed: ${data.message || res.statusText}`);
      } else {
        setMessage("Sign in successful!");
        await refreshSession();
      }
    } catch (err) {
      setMessage(`Sign in error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSignOut = async () => {
    setMessage("");
    try {
      const res = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setMessage("Signed out successfully");
        setSession(null);
      } else {
        setMessage("Sign out failed");
      }
    } catch (err) {
      setMessage(`Sign out error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Event Registration System</h1>

      {message && (
        <div
          style={{ margin: "1rem 0", padding: "0.5rem", border: "1px solid #ccc" }}
          data-testid="status-message"
        >
          {message}
        </div>
      )}

      {loading ? (
        <p>Loading session...</p>
      ) : session ? (
        <section data-testid="session-info">
          <h2>Current Session</h2>
          <p>
            User: <strong>{session.user.name}</strong> ({session.user.email})
          </p>
          <p>User ID: {session.user.id}</p>
          <button type="button" onClick={refreshSession} data-testid="refresh-session-button">
            Refresh Session
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            data-testid="sign-out-button"
            style={{ marginLeft: "1rem" }}
          >
            Sign Out
          </button>
        </section>
      ) : (
        <div style={{ display: "flex", gap: "2rem", marginTop: "2rem" }}>
          <section data-testid="sign-up-section">
            <h2>Sign Up</h2>
            <form onSubmit={handleSignUp}>
              <div>
                <label htmlFor="sign-up-name">Name: </label>
                <input
                  id="sign-up-name"
                  data-testid="sign-up-name"
                  value={signUpName}
                  onChange={(e) => setSignUpName(e.target.value)}
                  required
                />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <label htmlFor="sign-up-email">Email: </label>
                <input
                  id="sign-up-email"
                  type="email"
                  data-testid="sign-up-email"
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  required
                />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <label htmlFor="sign-up-password">Password: </label>
                <input
                  id="sign-up-password"
                  type="password"
                  data-testid="sign-up-password"
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" data-testid="sign-up-submit" style={{ marginTop: "0.5rem" }}>
                Sign Up
              </button>
            </form>
          </section>

          <section data-testid="sign-in-section">
            <h2>Sign In</h2>
            <form onSubmit={handleSignIn}>
              <div>
                <label htmlFor="sign-in-email">Email: </label>
                <input
                  id="sign-in-email"
                  type="email"
                  data-testid="sign-in-email"
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  required
                />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <label htmlFor="sign-in-password">Password: </label>
                <input
                  id="sign-in-password"
                  type="password"
                  data-testid="sign-in-password"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" data-testid="sign-in-submit" style={{ marginTop: "0.5rem" }}>
                Sign In
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
