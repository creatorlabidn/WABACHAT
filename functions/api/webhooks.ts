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

    // Ambil pesan masuk (incoming) dan pesan keluar (outgoing) dari KV secara paralel
    const [webhooksStr, outgoingStr] = await Promise.all([
      context.env.WA_WEBHOOKS.get("webhooks").then(v => v || "[]"),
      context.env.WA_WEBHOOKS.get("outgoing").then(v => v || "[]"),
    ]);

    const incoming: any[] = JSON.parse(webhooksStr);
    const outgoing: any[] = JSON.parse(outgoingStr);

    // Gabungkan pesan masuk dan keluar, urutkan berdasarkan timestamp
    const getTimestamp = (payload: any): number => {
      try {
        const ts = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp;
        return ts ? parseInt(ts) : 0;
      } catch { return 0; }
    };
    const all = [...incoming, ...outgoing].sort((a, b) => getTimestamp(a) - getTimestamp(b));

    // Filter berdasarkan phoneId jika dikirim
    if (phoneId) {
      const filtered = all.filter((payload: any) => {
        try {
          const isCustom = payload?.object === "custom_webhook";
          if (isCustom) return true;
          // Untuk pesan masuk, cek metadata.phone_number_id
          // Untuk pesan keluar, cek _to (nomor tujuan) atau metadata.phone_number_id
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

    return new Response(JSON.stringify(all), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("[]", {
      headers: { "Content-Type": "application/json" }
    });
  }
};