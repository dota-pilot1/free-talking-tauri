import { apiFetch } from "../../../shared/api/client";
import type { TokenResponse } from "../../../entities/user/model/types";

type SignupResponse = {
  id: number;
  email: string;
  username: string;
  roleCode?: string;
};

type ErrorBody = {
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function login(apiUrl: string, email: string, password: string) {
  let response: Response;
  try {
    response = await apiFetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error("백엔드 서버가 실행 중인지 확인하세요.");
  }

  if (!response.ok) {
    let message = response.status === 401 ? "이메일 또는 비밀번호가 올바르지 않습니다." : `로그인 실패 (HTTP ${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // ignore invalid error body
    }
    throw new Error(message);
  }

  return (await response.json()) as TokenResponse;
}

export async function signup(apiUrl: string, email: string, username: string, password: string) {
  let response: Response;
  try {
    response = await apiFetch(`${apiUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });
  } catch {
    throw new Error("백엔드 서버가 실행 중인지 확인하세요.");
  }

  if (!response.ok) {
    let message = `회원가입 실패 (HTTP ${response.status})`;
    try {
      const data = (await response.json()) as ErrorBody;
      const fieldMessage = data.fieldErrors ? Object.values(data.fieldErrors)[0] : "";
      message = fieldMessage || data.message || message;
    } catch {
      // ignore invalid error body
    }
    throw new Error(message);
  }

  return (await response.json()) as SignupResponse;
}

export async function logout(apiUrl: string, token: string) {
  if (!token) return;
  await apiFetch(`${apiUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}
