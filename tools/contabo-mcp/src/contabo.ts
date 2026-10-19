import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";

type ContaboCfg = NonNullable<Config["contabo"]>;

const AUTH_URL = "https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token";
const API = "https://api.contabo.com";

/** Cliente mínimo de la API de Contabo (instancias y snapshots). */
export class Contabo {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: ContaboCfg) {}

  get instanceId(): string {
    return this.cfg.instanceId;
  }
  get powerActionsAllowed(): boolean {
    return this.cfg.allowPowerActions;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 30_000) return this.token.value;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      username: this.cfg.apiUser,
      password: this.cfg.apiPassword,
      grant_type: "password",
    });
    const r = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Contabo: no se pudo autenticar (HTTP ${r.status}). Revisa Client ID/Secret, API user y API password.`);
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 };
    return j.access_token;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          "x-request-id": randomUUID(),
          "x-trace-id": "izao-contabo-mcp",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        continue;
      }
      if (r.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if (r.status === 204) return undefined as T;
      const text = await r.text();
      if (!r.ok) throw new Error(`Contabo ${method} ${path}: HTTP ${r.status} ${text.slice(0, 500)}`);
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw new Error("Contabo: límite de peticiones alcanzado, intenta más tarde");
  }

  listInstances() {
    return this.request<{ data: unknown[] }>("GET", "/v1/compute/instances?size=50");
  }
  getInstance(id = this.cfg.instanceId) {
    return this.request<{ data: unknown[] }>("GET", `/v1/compute/instances/${encodeURIComponent(id)}`);
  }
  listSnapshots(id = this.cfg.instanceId) {
    return this.request<{ data: Array<{ snapshotId: string; name: string; description?: string; createdDate?: string }> }>(
      "GET",
      `/v1/compute/instances/${encodeURIComponent(id)}/snapshots`,
    );
  }
  createSnapshot(name: string, description: string, id = this.cfg.instanceId) {
    return this.request("POST", `/v1/compute/instances/${encodeURIComponent(id)}/snapshots`, { name, description });
  }
  deleteSnapshot(snapshotId: string, id = this.cfg.instanceId) {
    return this.request("DELETE", `/v1/compute/instances/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`);
  }
  powerAction(action: "start" | "stop" | "restart" | "shutdown", id = this.cfg.instanceId) {
    return this.request("POST", `/v1/compute/instances/${encodeURIComponent(id)}/actions/${action}`);
  }
}

export function snapshotName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `izao-mcp-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}
