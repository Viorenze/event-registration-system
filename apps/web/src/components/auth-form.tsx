"use client";

import { useState } from "react";
import { signInEmail, signUpEmail } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface AuthFormProps {
  onAuthenticated: () => void;
}

export function AuthForm({ onAuthenticated }: AuthFormProps) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    setSubmitting(true);

    try {
      if (mode === "signUp") {
        const res = await signUpEmail({
          name: name.trim(),
          email: email.trim(),
          password,
        });
        if (res.ok) {
          onAuthenticated();
        } else {
          setErrorMessage(res.message);
        }
      } else {
        const res = await signInEmail({
          email: email.trim(),
          password,
        });
        if (res.ok) {
          onAuthenticated();
        } else {
          setErrorMessage(res.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === "signIn" ? "signUp" : "signIn"));
    setErrorMessage("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {mode === "signUp" && (
        <div className="space-y-2">
          <Label htmlFor="auth-name">姓名</Label>
          <Input
            id="auth-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="auth-email">邮箱</Label>
        <Input
          id="auth-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="auth-password">密码</Label>
        <Input
          id="auth-password"
          name="password"
          type="password"
          required
          minLength={mode === "signUp" ? 8 : undefined}
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />
        {mode === "signUp" && <p className="text-xs text-muted-foreground">至少 8 位</p>}
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting
            ? mode === "signIn"
              ? "登录中…"
              : "注册中…"
            : mode === "signIn"
              ? "登录"
              : "注册"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={switchMode}
          disabled={submitting}
          className="w-full"
        >
          {mode === "signIn" ? "没有账号？点击注册" : "已有账号？点击登录"}
        </Button>
      </div>
    </form>
  );
}
