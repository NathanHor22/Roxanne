"use client";

import { useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/client";

import styles from "./login.module.css";

type LoginButtonProps = {
  nextPath: string;
};

export function LoginButton({ nextPath }: LoginButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("Supabase authentication is not configured.");
      setLoading(false);
      return;
    }

    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", nextPath);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        queryParams: { prompt: "select_account" },
      },
    });

    if (signInError) {
      setError("Google sign-in could not be started. Please try again.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={styles.googleButton}
        disabled={loading}
        onClick={signIn}
        type="button"
      >
        <span aria-hidden="true" className={styles.googleMark}>G</span>
        {loading ? "Opening Google…" : "Continue with Google"}
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </>
  );
}
