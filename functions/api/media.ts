export const onRequestGet: PagesFunction = async (context) => {
  try {
    const url = new URL(context.request.url);
    const mediaId = url.searchParams.get("id");
    const token = url.searchParams.get("token");

    if (!mediaId || !token) {
      return new Response("Missing parameters", { status: 400 });
    }

    // 1. Get media URL
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!mediaRes.ok) {
        return new Response("Failed to get media info", { status: mediaRes.status });
    }

    const mediaInfo = await mediaRes.json() as any;
    const mediaUrl = mediaInfo.url;
    const mediaMime = mediaInfo.mime_type;

    // 2. Download media
    const imgRes = await fetch(mediaUrl, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!imgRes.ok) {
        return new Response("Failed to download media", { status: imgRes.status });
    }

    // Return the media blob with the correct content type
    return new Response(imgRes.body, {
      status: 200,
      headers: {
        "Content-Type": mediaMime || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000"
      }
    });

  } catch (error) {
    return new Response(String(error), { status: 500 });
  }
};
