export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json() as any;
    const { to, message, token, phoneId } = body;
    
    if (!to || !message || !token || !phoneId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    // Call WhatsApp Graph API
    const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
      })
    });

    const data = await waRes.json();
    
    return new Response(JSON.stringify(data), {
      status: waRes.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
};
