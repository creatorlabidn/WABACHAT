export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json();
    
    // Process custom webhook data here (e.g. from n8n)
    console.log("Received Custom Webhook:", JSON.stringify(body, null, 2));

    // Optional: Save to KV if you want to store it
    // const existingStr = await context.env.WA_WEBHOOKS.get("custom_webhooks") || "[]";
    // const existing = JSON.parse(existingStr);
    // existing.push({ timestamp: Date.now(), data: body });
    // if (existing.length > 50) existing.shift();
    // await context.env.WA_WEBHOOKS.put("custom_webhooks", JSON.stringify(existing));

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Custom webhook received successfully" 
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: "Invalid request body" 
    }), { 
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
};
