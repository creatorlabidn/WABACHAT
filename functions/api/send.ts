export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as any;
    const { to, message, token, phoneId, type, mediaId, filename, replyToId } = body;
    
    if (!to || (!message && !mediaId) || !token || !phoneId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    let payload: any = {
      messaging_product: "whatsapp",
      to: to,
    };

    if (replyToId) {
      payload.context = {
        message_id: replyToId
      };
    }

    if (type === 'image' && mediaId) {
      payload.type = "image";
      payload.image = {
        id: mediaId,
        caption: message || ""
      };
    } else if (type === 'video' && mediaId) {
      payload.type = "video";
      payload.video = {
        id: mediaId,
        caption: message || ""
      };
    } else if (type === 'document' && mediaId) {
      payload.type = "document";
      payload.document = {
        id: mediaId,
        caption: message || "",
        filename: filename || "document.pdf"
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

    const data = await waRes.json() as any;

    // Simpan pesan keluar ke KV jika berhasil
    if (waRes.ok && data.messages && data.messages.length > 0 && context.env.WA_WEBHOOKS) {
      try {
        const realMessageId = data.messages[0].id;

        // Buat struktur yang seragam dengan format webhook masuk dari WhatsApp
        const outgoingEntry = {
          object: "whatsapp_business_account",
          entry: [{
            changes: [{
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneId },
                messages: [{
                  from: "me",
                  id: realMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: type || "text",
                  ...(type === "text" || !type ? { text: { body: message } } : {}),
                  ...(type === "image" && mediaId ? { image: { id: mediaId, caption: message || "" } } : {}),
                  ...(type === "video" && mediaId ? { video: { id: mediaId, caption: message || "" } } : {}),
                  ...(type === "document" && mediaId ? { document: { id: mediaId, caption: message || "", filename: filename || "document.pdf" } } : {}),
                  ...(replyToId ? { context: { id: replyToId } } : {}),
                }],
                contacts: [{ profile: { name: "Me" }, wa_id: phoneId }],
              },
              field: "messages"
            }]
          }],
          _outgoing: true,       // flag untuk membedakan dari pesan masuk
          _to: to,               // nomor tujuan, untuk filter di frontend
        };

        const existingStr = await context.env.WA_WEBHOOKS.get("outgoing") || "[]";
        const existing: any[] = JSON.parse(existingStr);
        existing.push(outgoingEntry);

        // Batasi 200 pesan keluar terakhir
        if (existing.length > 200) existing.shift();

        await context.env.WA_WEBHOOKS.put("outgoing", JSON.stringify(existing));
      } catch (kvErr) {
        // Jangan gagalkan response utama jika KV error
        console.error("KV save outgoing error:", kvErr);
      }
    }
    
    return new Response(JSON.stringify(data), {
      status: waRes.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
};