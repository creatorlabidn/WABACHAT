export const onRequestPost: PagesFunction = async (context) => {
  try {
    const formData = await context.request.formData();
    const token = formData.get("token") as string;
    const phoneId = formData.get("phoneId") as string;
    const file = formData.get("file") as File;

    if (!token || !phoneId || !file) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    // Prepare FormData for WhatsApp API
    const waFormData = new FormData();
    waFormData.append("messaging_product", "whatsapp");
    waFormData.append("file", file);

    const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      },
      body: waFormData
    });

    const responseText = await waRes.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("Facebook API returned non-JSON:", responseText);
      return new Response(JSON.stringify({ error: "Invalid response from Facebook", details: responseText }), {
        status: waRes.status > 0 ? waRes.status : 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify(result), {
      status: waRes.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
