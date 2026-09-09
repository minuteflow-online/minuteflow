// Account -> client name lookup, ported from src/hooks/useAccountsAndClients.ts.
// Starting an assigned task needs it to fill time_logs.client_name correctly
// (that field drives invoicing/reporting — see AGENTS.md's Invoice System
// section), the same way the web dashboard's handlePlayAssignedTask does.
import { query } from "./db";

interface AccountRow {
  id: number;
  name: string;
}

interface ClientRow {
  id: number;
  name: string;
}

interface MappingRow {
  account_id: number;
  client_id: number;
}

/** Map of account name -> its mapped client name (accounts/clients with no
 *  mapping row are simply absent, same as the web app's accountClientMap). */
export async function fetchAccountClientMap(): Promise<Record<string, string>> {
  const [accounts, clients, mappings] = await Promise.all([
    query<AccountRow[]>("accounts", { filters: "select=id,name" }),
    query<ClientRow[]>("clients", { filters: "select=id,name" }),
    query<MappingRow[]>("account_client_map", { filters: "select=account_id,client_id" }),
  ]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  const map: Record<string, string> = {};
  for (const m of mappings) {
    const account = accountsById.get(m.account_id);
    const client = clientsById.get(m.client_id);
    if (account && client) map[account.name] = client.name;
  }
  return map;
}
