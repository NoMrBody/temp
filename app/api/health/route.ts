export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      ok: true,
      keyConfigured: !!process.env.GEMINI_API_KEY,
      accessRequired: !!process.env.ACCESS_CODE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
