const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: JSON_HEADERS
  });
}

function boundedString(value, length) {
  return String(value == null ? "" : value).slice(0, length);
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeVehicle(input) {
  const source = input && typeof input === "object" ? input : {};
  const allowedTypes = ["truck", "moto", "bus", "other"];
  const unit = source.unit === "h" ? "h" : "km";
  return {
    id: boundedString(source.id, 100),
    assetCode: boundedString(source.assetCode, 100),
    plate: boundedString(source.plate, 20),
    model: boundedString(source.model, 140),
    driver: boundedString(source.driver, 120),
    type: allowedTypes.includes(source.type) ? source.type : "other",
    unit: unit,
    current: finiteOrNull(source.current),
    nextService: finiteOrNull(source.nextService),
    interval: finiteOrNull(source.interval),
    remaining: finiteOrNull(source.remaining),
    tolerance: finiteOrNull(source.tolerance),
    toleranceEstimated: Boolean(source.toleranceEstimated),
    planEstimated: Boolean(source.planEstimated),
    maintenance: boundedString(source.maintenance, 160),
    measuredAt: boundedString(source.measuredAt, 60)
  };
}

function equalSecret(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < received.length; index += 1) {
    mismatch |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

async function getFleet(env) {
  if (!env.FLEET_DB) return json({ error: "O banco da frota ainda não foi configurado." }, 503);
  const row = await env.FLEET_DB.prepare(
    "SELECT snapshot, updated_at FROM fleet_snapshots WHERE id = ?"
  ).bind("main").first();
  if (!row) return json({ vehicles: [], updatedAt: null }, 200);
  try {
    const snapshot = JSON.parse(row.snapshot);
    return json({ vehicles: Array.isArray(snapshot.vehicles) ? snapshot.vehicles : [], updatedAt: row.updated_at }, 200);
  } catch {
    return json({ error: "O snapshot da frota não pôde ser lido." }, 500);
  }
}

async function importFleet(request, env) {
  if (!env.IMPORT_TOKEN) return json({ error: "A chave de importação ainda não foi configurada no Cloudflare." }, 503);
  const authorization = request.headers.get("Authorization") || "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!equalSecret(received, env.IMPORT_TOKEN)) return json({ error: "Chave de atualização inválida." }, 401);
  if (!env.FLEET_DB) return json({ error: "O banco da frota ainda não foi configurado." }, 503);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 500000) return json({ error: "O relatório ficou grande demais para esta atualização." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "O conteúdo enviado não é um JSON válido." }, 400);
  }
  if (!body || !Array.isArray(body.vehicles)) return json({ error: "A lista de veículos não foi encontrada." }, 400);
  if (body.vehicles.length > 500) return json({ error: "O limite é de 500 veículos por relatório." }, 400);
  const vehicles = body.vehicles.map(sanitizeVehicle).filter((item) => item.id && (item.assetCode || item.plate));
  if (vehicles.length !== body.vehicles.length) return json({ error: "Um ou mais veículos não possuem código ou placa válidos." }, 400);
  const updatedAt = new Date().toISOString();
  const snapshot = JSON.stringify({ vehicles: vehicles });
  if (new TextEncoder().encode(snapshot).byteLength > 450000) return json({ error: "Os dados do relatório excedem o limite permitido." }, 413);
  await env.FLEET_DB.prepare(
    "INSERT INTO fleet_snapshots (id, snapshot, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at"
  ).bind("main", snapshot, updatedAt).run();
  return json({ ok: true, count: vehicles.length, updatedAt: updatedAt }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/fleet" && request.method === "GET") {
      try {
        return await getFleet(env);
      } catch {
        return json({ error: "Não foi possível consultar o banco da frota." }, 500);
      }
    }
    if (url.pathname === "/api/import" && request.method === "POST") {
      try {
        return await importFleet(request, env);
      } catch {
        return json({ error: "Não foi possível salvar a atualização da frota." }, 500);
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Rota não encontrada." }, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Frontend assets binding is missing.", { status: 500 });
  }
};

