import "@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const DB_HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
}

async function dbGet(table: string, query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: DB_HEADERS })
  const text = await res.text()
  if (!res.ok) throw new Error(`DB get ${table} failed: ${text}`)
  if (!text) return []
  return JSON.parse(text)
}

async function dbPost(table: string, rows: object[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...DB_HEADERS, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`DB insert ${table} failed: ${await res.text()}`)
}

async function dbUpsert(table: string, data: object): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id,key`, {
    method: "POST",
    headers: {
      ...DB_HEADERS,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`DB upsert ${table} failed: ${await res.text()}`)
}

function applyRules(payee: string, rules: any[]): string | null {
  const lower = payee.toLowerCase()
  for (const rule of rules) {
    const kw = rule.keyword.toLowerCase()
    if (rule.match_type === "contains" && lower.includes(kw)) return rule.category_id
    if (rule.match_type === "startswith" && lower.startsWith(kw)) return rule.category_id
    if (rule.match_type === "exact" && lower === kw) return rule.category_id
  }
  return null
}

async function syncUser(
  userId: string,
  accessUrl: string,
  accountMap: Record<string, string>,
  thresholds: Record<string, any>,
  rules: any[]
): Promise<{ imported: number; alerts: string[] }> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const startTs = Math.floor(startOfMonth.getTime() / 1000)

  const sfUrl = new URL(accessUrl + "/accounts")
  sfUrl.searchParams.set("start-date", String(startTs))

  const sfRes = await fetch(sfUrl.toString())
  if (!sfRes.ok) throw new Error(`SimpleFin fetch failed: ${await sfRes.text()}`)
  const sfData = await sfRes.json()
  const sfAccounts: any[] = sfData.accounts || []

  let totalImported = 0
  const alerts: string[] = []

  for (const sfAcct of sfAccounts) {
    const bnabAccountId = accountMap[sfAcct.id]
    if (!bnabAccountId) continue

    // Check balance threshold
    const threshold = thresholds[sfAcct.id]
    if (threshold?.enabled && sfAcct.balance !== undefined) {
      const balance = parseFloat(sfAcct.balance)
      const displayBalance = Math.abs(balance)
      const acctName = sfAcct.name || sfAcct.id
      if (threshold.type === "low" && balance < threshold.amount) {
        alerts.push(
          `${acctName}: balance $${balance.toFixed(2)} is below your alert of $${Number(threshold.amount).toFixed(2)}`
        )
      } else if (threshold.type === "high" && displayBalance > threshold.amount) {
        alerts.push(
          `${acctName}: balance $${displayBalance.toFixed(2)} exceeds your alert of $${Number(threshold.amount).toFixed(2)}`
        )
      }
    }

    const txns: any[] = sfAcct.transactions || []
    if (!txns.length) continue

    const existing = await dbGet(
      "transactions",
      `account_id=eq.${bnabAccountId}&import_id=not.is.null&select=import_id`
    )
    const existingIds = new Set(existing.map((r: any) => r.import_id))

    const toInsert: object[] = []
    for (const tx of txns) {
      const importId = `sf_${tx.id}`
      if (existingIds.has(importId)) continue

      const amount = parseFloat(tx.amount)
      const absAmount = Math.abs(amount)
      const type = amount >= 0 ? "income" : "expense"
      const date = new Date(tx.transacted_at * 1000).toISOString().split("T")[0]
      const payee = tx.payee || tx.description || "Unknown"
      const categoryId = applyRules(payee, rules)
      const signedAmount = type === "expense" ? -absAmount : absAmount

      toInsert.push({
        user_id: userId,
        account_id: bnabAccountId,
        date,
        payee,
        memo: tx.memo || "",
        amount: signedAmount,
        type,
        cleared: true,
        import_id: importId,
        category_id: categoryId,
      })
    }

    if (toInsert.length > 0) {
      await dbPost("transactions", toInsert)
      totalImported += toInsert.length
    }
  }

  return { imported: totalImported, alerts }
}

Deno.serve(async (_req) => {
  try {
    const urlSettings = await dbGet("user_settings", "key=eq.simplefin_access_url&select=user_id,value")

    const results: object[] = []

    for (const { user_id: userId, value: accessUrl } of urlSettings) {
      try {
        const [mapSettings, thresholdSettings, rules] = await Promise.all([
          dbGet("user_settings", `user_id=eq.${userId}&key=eq.simplefin_account_map&select=value`),
          dbGet("user_settings", `user_id=eq.${userId}&key=eq.alert_thresholds&select=value`),
          dbGet("auto_categorize_rules", `user_id=eq.${userId}&order=sort_order.asc`),
        ])

        const accountMap: Record<string, string> = mapSettings[0]
          ? JSON.parse(mapSettings[0].value)
          : {}
        const thresholds: Record<string, any> = thresholdSettings[0]
          ? JSON.parse(thresholdSettings[0].value)
          : {}

        if (!Object.keys(accountMap).length) {
          results.push({ userId, status: "skipped", reason: "no account map" })
          continue
        }

        const { imported, alerts } = await syncUser(userId, accessUrl, accountMap, thresholds, rules)

        await dbUpsert("user_settings", {
          user_id: userId,
          key: "simplefin_last_synced",
          value: new Date().toISOString(),
        })

        // Store alerts in user_settings so the app shows a banner on next login
        if (alerts.length > 0) {
          await dbUpsert("user_settings", {
            user_id: userId,
            key: "pending_alerts",
            value: JSON.stringify(alerts),
          })
        }

        results.push({ userId, status: "ok", imported, alerts: alerts.length })
      } catch (err) {
        results.push({ userId, status: "error", error: (err as Error).message })
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
