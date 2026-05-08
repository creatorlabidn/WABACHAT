export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
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
