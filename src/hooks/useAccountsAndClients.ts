"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

interface Account {
  id: number;
  name: string;
  active: boolean;
}

interface Client {
  id: number;
  name: string;
  active: boolean;
}

interface AccountClientMapping {
  account_id: number;
  client_id: number;
}

export function useAccountsAndClients() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [mappings, setMappings] = useState<AccountClientMapping[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [accountsRes, clientsRes, mapRes] = await Promise.all([
        supabase.from("accounts").select("id, name, active").order("name"),
        supabase.from("clients").select("id, name, active").order("name"),
        supabase.from("account_client_map").select("account_id, client_id"),
      ]);

      if (accountsRes.data) setAccounts(accountsRes.data);
      if (clientsRes.data) setClients(clientsRes.data);
      if (mapRes.data) setMappings(mapRes.data);
      setLoaded(true);
    }
    load();
  }, []);

  const activeAccountNames = useMemo(
    () => accounts.filter((a) => a.active).map((a) => a.name),
    [accounts]
  );

  const allAccountNames = useMemo(
    () => accounts.map((a) => a.name),
    [accounts]
  );

  const activeClientNames = useMemo(
    () => clients.filter((c) => c.active).map((c) => c.name),
    [clients]
  );

  const accountClientMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mappings) {
      const account = accounts.find((a) => a.id === m.account_id);
      const client = clients.find((c) => c.id === m.client_id);
      if (account && client) {
        map[account.name] = client.name;
      }
    }
    return map;
  }, [accounts, clients, mappings]);

  return {
    accounts,
    clients,
    activeAccountNames,
    allAccountNames,
    activeClientNames,
    accountClientMap,
    loaded,
  };
}
