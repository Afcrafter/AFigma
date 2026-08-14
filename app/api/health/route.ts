/** 健康检查。 */
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, ts: Date.now() });
}
