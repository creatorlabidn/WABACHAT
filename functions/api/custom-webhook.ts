export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body: any = await context.request.json();
    
    console.log("Received Custom Webhook:", JSON.stringify(body, null, 2));

    const templateName = body.nama_template;
    const to = body.nomor_whatsapp;

    if (templateName && to && context.env.WA_WEBHOOKS) {
      const customEntry = {
        object: "custom_webhook",
        entry: [{
          changes: [{
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "custom" },
              messages: [{
                from: "me",
                id: "custom_" + Date.now(),
                timestamp: Math.floor(Date.now() / 1000).toString(),
                type: "template",
                template: { name: templateName }
              }],
              contacts: [{ profile: { name: "Me" }, wa_id: "custom" }],
            },
            field: "messages"
          }]
        }],
        _outgoing: true,
        _to: to,
      };

      const existingStr = await context.env.WA_WEBHOOKS.get("outgoing") || "[]";
      const existing: any[] = JSON.parse(existingStr);
      existing.push(customEntry);

      if (existing.length > 200) existing.shift();
      await context.env.WA_WEBHOOKS.put("outgoing", JSON.stringify(existing));
    }

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
