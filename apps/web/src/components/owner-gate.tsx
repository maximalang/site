"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  AuthenticationApiError,
  loadOwnerSession,
  loginOwner,
  logoutOwner,
  type OwnerSession,
} from "../client/auth-api";
import { ControlCenter } from "./control-center";

type AuthClient = {
  loadSession(): Promise<OwnerSession>;
  login(password: string): Promise<OwnerSession>;
  logout(csrfToken: string): Promise<void>;
};

const defaultAuthClient: AuthClient = {
  loadSession: () => loadOwnerSession(),
  login: (password) => loginOwner(password),
  logout: (csrfToken) => logoutOwner(csrfToken),
};

type GateState =
  | { kind: "CHECKING" }
  | { kind: "ANONYMOUS" }
  | { kind: "AUTHENTICATED"; session: OwnerSession }
  | { kind: "UNAVAILABLE" };

export function OwnerGate({ auth = defaultAuthClient }: { auth?: AuthClient }) {
  const [state, setState] = useState<GateState>({ kind: "CHECKING" });
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [checkNonce, setCheckNonce] = useState(0);

  useEffect(() => {
    void checkNonce;
    let active = true;
    setState({ kind: "CHECKING" });
    void auth
      .loadSession()
      .then((session) => {
        if (active) setState({ kind: "AUTHENTICATED", session });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof AuthenticationApiError && error.status === 401
            ? { kind: "ANONYMOUS" }
            : { kind: "UNAVAILABLE" },
        );
      });
    return () => {
      active = false;
    };
  }, [auth, checkNonce]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || password.length === 0 || new TextEncoder().encode(password).length > 1_024) {
      return;
    }
    setSubmitting(true);
    setLoginError(undefined);
    try {
      const session = await auth.login(password);
      setPassword("");
      setState({ kind: "AUTHENTICATED", session });
    } catch (error) {
      if (error instanceof AuthenticationApiError && error.status === 401) {
        setLoginError("Пароль не подошёл.");
      } else if (error instanceof AuthenticationApiError && error.status === 429) {
        setLoginError("Слишком много попыток. Повторите вход через 15 минут.");
      } else {
        setLoginError("Вход сейчас недоступен. Повторите позже.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === "AUTHENTICATED") {
    return (
      <ControlCenter
        csrfToken={state.session.csrfToken}
        onLogout={async () => {
          await auth.logout(state.session.csrfToken);
          setPassword("");
          setState({ kind: "ANONYMOUS" });
        }}
      />
    );
  }

  return (
    <div className="auth-shell">
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand" aria-hidden="true">
            AW
          </div>
          <p className="eyebrow">Доступ владельца</p>
          {state.kind === "CHECKING" ? (
            <>
              <h1 id="auth-title">Проверяем сессию</h1>
              <p aria-busy="true">Рабочий интерфейс остаётся закрытым до завершения проверки.</p>
            </>
          ) : null}
          {state.kind === "UNAVAILABLE" ? (
            <div role="alert">
              <h1 id="auth-title">Вход сейчас недоступен</h1>
              <p>Система не показывает ошибку пароля, если не может проверить сессию.</p>
              <button
                className="primary-button"
                onClick={() => setCheckNonce((value) => value + 1)}
                type="button"
              >
                Повторить
              </button>
            </div>
          ) : null}
          {state.kind === "ANONYMOUS" ? (
            <>
              <h1 id="auth-title">Вход владельца</h1>
              <p>Один локальный оператор. Пароль не сохраняется в браузере.</p>
              <form className="auth-form" onSubmit={login}>
                <label htmlFor="owner-password">Пароль владельца</label>
                <input
                  autoComplete="current-password"
                  id="owner-password"
                  maxLength={1_024}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setLoginError(undefined);
                  }}
                  required
                  type="password"
                  value={password}
                />
                {loginError ? (
                  <p className="auth-error" role="alert">
                    {loginError}
                  </p>
                ) : null}
                <button
                  className="primary-button"
                  disabled={submitting || password.length === 0}
                  type="submit"
                >
                  {submitting ? "Проверяем…" : "Войти"}
                </button>
              </form>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
