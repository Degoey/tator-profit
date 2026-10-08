import { NextResponse } from "next/server";

export interface ApiErrorBody {
  ok: false;
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
}

export function jsonSuccess<T>(data: T, status = 200): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(
  code: string,
  message: string,
  status = 400,
  fieldErrors?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ ok: false, code, message, fieldErrors }, { status });
}

/** Reads a JSON body defensively; returns `null` when the payload is not valid JSON. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
