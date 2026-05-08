export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json() as any;
    const { messageId, token, phoneId } = body;
    
    if (!messageId || !token || !phoneId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId
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
