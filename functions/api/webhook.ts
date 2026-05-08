export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const VERIFY_TOKEN = context.env.WHATSAPP_VERIFY_TOKEN || "my-verify-token";

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  return new Response("Bad Request", { status: 400 });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await context.request.json();
  
  if ((body as any).object) {
    // Store in KV
    try {
      const existingStr = await context.env.WA_WEBHOOKS.get("webhooks") || "[]";
      const existing = JSON.parse(existingStr);
      existing.push(body);
      
      // Keep only last 50 messages to avoid overloading KV value limits
      if (existing.length > 50) existing.shift();
      
      await context.env.WA_WEBHOOKS.put("webhooks", JSON.stringify(existing));
    } catch (e) {
      console.error("KV Error", e);
    }
    return new Response("OK", { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
};
