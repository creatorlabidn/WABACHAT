export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.WA_WEBHOOKS) {
      return new Response(JSON.stringify([{
        error: true,
        message: "KV Namespace 'WA_WEBHOOKS' belum dikonfigurasi di menu Cloudflare Pages."
      }]), { headers: { "Content-Type": "application/json" } });
    }
    const webhooksStr = await context.env.WA_WEBHOOKS.get("webhooks") || "[]";
    return new Response(webhooksStr, {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("[]", {
      headers: { "Content-Type": "application/json" }
    });
  }
};
