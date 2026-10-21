import "server-only";

// Чтение JSON из тела запроса с ограничением размера. Сначала смотрим
// заголовок Content-Length: слишком большой запрос отклоняется, не читая тело.
// Заголовка может не быть (тело передаётся частями), поэтому тело читается
// потоком и чтение обрывается, как только размер превышен.

export type JsonBodyResult =
  | { ok: true; data: unknown }
  | { ok: false; response: Response };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge() };

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, response: tooLarge() };
      }
      chunks.push(value);
    }
  }

  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return {
      ok: false,
      response: Response.json(
        { code: "bad-request", error: "Тело запроса должно быть JSON" },
        { status: 400 },
      ),
    };
  }
}

function tooLarge(): Response {
  return Response.json(
    { code: "too-large", error: "Слишком большой запрос" },
    { status: 413 },
  );
}
