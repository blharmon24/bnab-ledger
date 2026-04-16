import "@supabase/functions-js/edge-runtime.d.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const { action, setup_token, access_url, start_date } = await req.json()

    // Action: exchange a one-time setup token for a permanent access URL
    if (action === "claim") {
      if (!setup_token) {
        return new Response(JSON.stringify({ error: "setup_token is required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      // Decode the setup token to get the claim URL (token is base64 of the URL itself)
      const claimUrl = atob(setup_token)

      const response = await fetch(claimUrl, { method: "POST" })
      if (!response.ok) {
        const text = await response.text()
        return new Response(JSON.stringify({ error: `SimpleFin claim failed: ${text}` }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      const accessUrl = await response.text()
      return new Response(JSON.stringify({ access_url: accessUrl.trim() }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    }

    // Action: fetch accounts and transactions from SimpleFin
    if (action === "fetch") {
      if (!access_url) {
        return new Response(JSON.stringify({ error: "access_url is required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      // Build the accounts endpoint URL with optional start-date filter
      const url = new URL(access_url + "/accounts")
      if (start_date) {
        // start_date should be a Unix timestamp
        url.searchParams.set("start-date", String(start_date))
      }

      const response = await fetch(url.toString())
      if (!response.ok) {
        const text = await response.text()
        return new Response(JSON.stringify({ error: `SimpleFin fetch failed: ${text}` }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      const data = await response.json()
      return new Response(JSON.stringify(data), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use 'claim' or 'fetch'." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }
})
