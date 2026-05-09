export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.WA_WEBHOOKS) {
      return new Response(JSON.stringify([{
        error: true,
        message: "KV Namespace 'WA_WEBHOOKS' belum dikonfigurasi di menu Cloudflare Pages."
      }]), { headers: { "Content-Type": "application/json" } });
    }

    const url = new URL(context.request.url);
    const phoneId = url.searchParams.get("phoneId");

    const webhooksStr = await context.env.WA_WEBHOOKS.get("webhooks") || "[]";
    const webhooks: any[] = JSON.parse(webhooksStr);

    // Jika phoneId dikirim, filter hanya pesan untuk nomor tersebut
    if (phoneId) {
      const filtered = webhooks.filter((payload: any) => {
        try {
          const metadata = payload?.entry?.[0]?.changes?.[0]?.value?.metadata;
          return metadata?.phone_number_id === phoneId;
        } catch {
          return false;
        }
      });
      return new Response(JSON.stringify(filtered), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(webhooksStr, {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("[]", {
      headers: { "Content-Type": "application/json" }
    });
  }
};