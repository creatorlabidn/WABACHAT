export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json() as any;
    const { to, message, token, phoneId, type, mediaId } = body;
    
    if (!to || (!message && !mediaId) || !token || !phoneId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    let payload: any = {
      messaging_product: "whatsapp",
      to: to,
    };

    if (type === 'image' && mediaId) {
      payload.type = "image";
      payload.image = {
        id: mediaId,
        caption: message || ""
      };
    } else {
      payload.type = "text";
      payload.text = { body: message };
    }

    // Call WhatsApp Graph API
    const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
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
