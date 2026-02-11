import { Resend } from "resend";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const page = String(body?.page ?? "").trim();

    if (!email || !message) {
      return Response.json({ error: "Email and message are required." }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "RESEND_API_KEY is not set." }, { status: 500 });
    }

    const resend = new Resend(apiKey);
    const subject = `TheBinder Support${name ? ` — ${name}` : ""}`;

    const text = [
      `From: ${name || "Anonymous"}`,
      `Email: ${email}`,
      page ? `Page: ${page}` : "",
      "",
      message,
    ]
      .filter(Boolean)
      .join("\n");

    const { error } = await resend.emails.send({
      from: "TheBinder Support <support@thebinder.app>",
      to: ["support@thebinder.app"],
      replyTo: email,
      subject,
      text,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send message.";
    return Response.json({ error: message }, { status: 500 });
  }
}
