export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', service: 'web', uptime: Math.round(process.uptime()), time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
